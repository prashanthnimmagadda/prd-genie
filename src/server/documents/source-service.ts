import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ApiError } from '../../shared/api.js';
import { config, embeddingModel } from '../config.js';
import type { AppDatabase } from '../db/client.js';
import { chunks, sourceLocations, sources } from '../db/schema.js';
import type { EmbeddingService } from '../retrieval/embedding-service.js';
import { chunkText } from '../retrieval/chunker.js';
import { parseDocument } from './parser.js';

export class SourceService {
  private readonly jobs = new Set<Promise<void>>();

  constructor(
    private readonly database: AppDatabase,
    private readonly embeddings: EmbeddingService,
  ) {}

  async add(projectId: string, name: string, buffer: Buffer) {
    if (buffer.length === 0) throw new ApiError(400, 'empty_file', 'The uploaded file is empty.');
    if (buffer.length > config.maxUploadBytes) {
      throw new ApiError(413, 'file_too_large', 'Source files must be 25 MB or smaller.');
    }
    const parsed = await parseDocument(name, buffer);
    if (parsed.locations.length === 0) {
      throw new ApiError(422, 'empty_document', 'No extractable text was found in the source.');
    }
    const hash = createHash('sha256').update(buffer).digest('hex');
    const duplicate = this.database.sqlite
      .prepare('SELECT id FROM sources WHERE project_id = ? AND hash = ?')
      .get(projectId, hash) as { id: string } | undefined;
    if (duplicate) {
      throw new ApiError(409, 'duplicate_source', 'This source is already part of the project.');
    }

    fs.mkdirSync(config.sourceDir, { recursive: true, mode: 0o700 });
    const extension = path.extname(name).toLowerCase();
    const binaryPath = path.join(config.sourceDir, `${hash}${extension}`);
    const createdBinary = !fs.existsSync(binaryPath);
    if (createdBinary) fs.writeFileSync(binaryPath, buffer, { mode: 0o600, flag: 'wx' });
    const sourceId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const source = {
      id: sourceId,
      projectId,
      name,
      mediaType: parsed.mediaType,
      size: buffer.length,
      hash,
      binaryPath,
      status: 'processing',
      error: parsed.warnings.length > 0 ? parsed.warnings.join(' ') : null,
      createdAt: timestamp,
    };

    const allChunks = parsed.locations.flatMap((location) =>
      chunkText({
        locationId: location.id,
        content: location.content,
        documentHash: hash,
        startOffset: location.startOffset,
      }),
    );

    try {
      this.database.sqlite.transaction(() => {
        this.database.db.insert(sources).values(source).run();
        this.database.db
          .insert(sourceLocations)
          .values(
            parsed.locations.map((location) => ({
              ...location,
              sourceId,
            })),
          )
          .run();
        this.database.db
          .insert(chunks)
          .values(
            allChunks.map((chunk) => ({
              ...chunk,
              projectId,
              sourceId,
            })),
          )
          .run();
        const insertFts = this.database.sqlite.prepare(
          'INSERT INTO chunks_fts (chunk_id, project_id, content) VALUES (?, ?, ?)',
        );
        for (const chunk of allChunks) insertFts.run(chunk.id, projectId, chunk.content);
      })();
    } catch (error) {
      if (createdBinary && fs.existsSync(binaryPath)) fs.unlinkSync(binaryPath);
      throw error;
    }

    this.scheduleIndex(
      sourceId,
      allChunks.map((chunk) => ({ id: chunk.id, content: chunk.content })),
      parsed.partial,
      parsed.warnings,
    );
    return {
      id: source.id,
      projectId: source.projectId,
      name: source.name,
      mediaType: source.mediaType,
      size: source.size,
      hash: source.hash,
      status: source.status,
      error: source.error,
      createdAt: source.createdAt,
    };
  }

  retry(projectId: string, sourceId: string) {
    const source = this.database.sqlite
      .prepare(
        `SELECT id, project_id AS projectId, name, media_type AS mediaType, size, hash,
                status, error, created_at AS createdAt
         FROM sources WHERE id = ? AND project_id = ?`,
      )
      .get(sourceId, projectId) as
      | {
          id: string;
          projectId: string;
          name: string;
          mediaType: string;
          size: number;
          hash: string;
          status: 'processing' | 'ready' | 'partial' | 'failed';
          error: string | null;
          createdAt: string;
        }
      | undefined;
    if (!source) throw new ApiError(404, 'source_not_found', 'Source not found.');
    if (source.status === 'processing') {
      throw new ApiError(409, 'index_in_progress', 'This source is already being indexed.');
    }
    const items = this.database.sqlite
      .prepare('SELECT id, content FROM chunks WHERE source_id = ? ORDER BY ordinal')
      .all(sourceId) as Array<{ id: string; content: string }>;
    this.updateStatus(sourceId, 'processing', null);
    this.scheduleIndex(sourceId, items, false, []);
    return { ...source, status: 'processing' as const, error: null };
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.jobs]);
  }

  private scheduleIndex(
    sourceId: string,
    items: Array<{ id: string; content: string }>,
    parsePartial: boolean,
    parseWarnings: string[],
  ): void {
    const job = this.indexEmbeddings(sourceId, items, parsePartial, parseWarnings);
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job));
  }

  private async indexEmbeddings(
    sourceId: string,
    items: Array<{ id: string; content: string }>,
    parsePartial: boolean,
    parseWarnings: string[],
  ): Promise<void> {
    const batchSize = 24;
    try {
      for (let offset = 0; offset < items.length; offset += batchSize) {
        const batch = items.slice(offset, offset + batchSize);
        const vectors = await this.embeddings.embed(batch.map((item) => item.content));
        if (
          vectors.length !== batch.length ||
          vectors.some((vector) => vector.length !== embeddingModel.dimensions)
        ) {
          throw new Error('The embedding worker returned an invalid vector batch.');
        }
        this.database.sqlite.transaction(() => {
          const statement = this.database.sqlite.prepare(`
            UPDATE chunks
            SET embedding = ?, embedding_model = ?, embedding_revision = ?, embedding_dimensions = ?
            WHERE id = ?
          `);
          const insertVector = this.database.vectorAvailable
            ? this.database.sqlite.prepare(
                'INSERT OR REPLACE INTO chunk_vectors (chunk_id, embedding) VALUES (?, ?)',
              )
            : null;
          batch.forEach((item, index) => {
            const vector = vectors[index]!;
            const serialized = JSON.stringify(vector);
            const update = statement.run(
              serialized,
              embeddingModel.id,
              embeddingModel.revision,
              embeddingModel.dimensions,
              item.id,
            );
            if (update.changes === 1) insertVector?.run(item.id, serialized);
          });
        })();
      }
      this.updateStatus(
        sourceId,
        parsePartial ? 'partial' : 'ready',
        parseWarnings.length > 0 ? parseWarnings.join(' ') : null,
      );
    } catch {
      try {
        this.updateStatus(
          sourceId,
          'partial',
          'Semantic indexing is unavailable. Lexical evidence search remains ready.',
        );
      } catch {
        // The source or database may have been removed while the background job was finishing.
      }
    }
  }

  private updateStatus(
    sourceId: string,
    status: 'processing' | 'ready' | 'partial' | 'failed',
    error: string | null,
  ): void {
    this.database.sqlite
      .prepare('UPDATE sources SET status = ?, error = ? WHERE id = ?')
      .run(status, error, sourceId);
  }
}
