import type { Citation } from '../../shared/types.js';
import type { AppDatabase } from '../db/client.js';
import { cosineSimilarity, reciprocalRankFusion, type RankedCandidate } from './fusion.js';
import type { EmbeddingService } from './embedding-service.js';
import { estimateTokens } from './chunker.js';

interface ChunkRow {
  id: string;
  sourceId: string;
  sourceName: string;
  locationId: string;
  locator: string;
  content: string;
  embedding: string | null;
}

export class RetrievalService {
  constructor(
    private readonly database: AppDatabase,
    private readonly embeddings: EmbeddingService,
  ) {}

  async retrieve(projectId: string, query: string, tokenBudget = 1600): Promise<Citation[]> {
    const terms = query
      .toLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu)
      ?.slice(0, 16);
    if (!terms?.length) return [];
    const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
    const lexicalRows = this.database.sqlite
      .prepare(
        `
          SELECT chunks.id, chunks.source_id AS sourceId, sources.name AS sourceName,
                 chunks.location_id AS locationId, source_locations.locator,
                 chunks.content, chunks.embedding
          FROM chunks_fts
          JOIN chunks ON chunks.id = chunks_fts.chunk_id
          JOIN sources ON sources.id = chunks.source_id
          JOIN source_locations ON source_locations.id = chunks.location_id
          WHERE chunks_fts MATCH ? AND chunks_fts.project_id = ?
          ORDER BY bm25(chunks_fts)
          LIMIT 40
        `,
      )
      .all(match, projectId) as ChunkRow[];
    const lexical: RankedCandidate[] = lexicalRows.map((row) => ({
      id: row.id,
      sourceId: row.sourceId,
    }));

    let vector: RankedCandidate[] = [];
    try {
      const [queryEmbedding] = await this.embeddings.embed([query]);
      if (queryEmbedding) {
        if (this.database.vectorAvailable) {
          const nearest = this.database.sqlite
            .prepare(
              `
                SELECT chunk_id AS id, distance
                FROM chunk_vectors
                WHERE embedding MATCH ? AND k = 200
                ORDER BY distance
              `,
            )
            .all(JSON.stringify(queryEmbedding)) as Array<{ id: string; distance: number }>;
          const projectChunk = this.database.sqlite.prepare(
            'SELECT source_id AS sourceId FROM chunks WHERE id = ? AND project_id = ?',
          );
          vector = nearest
            .flatMap((candidate) => {
              const row = projectChunk.get(candidate.id, projectId) as
                { sourceId: string } | undefined;
              return row
                ? [{ id: candidate.id, sourceId: row.sourceId, score: -candidate.distance }]
                : [];
            })
            .slice(0, 40);
        } else {
          const candidateRows = this.database.sqlite
            .prepare(
              `
                SELECT id, source_id AS sourceId, embedding
                FROM chunks
                WHERE project_id = ? AND embedding IS NOT NULL
              `,
            )
            .all(projectId) as Array<{ id: string; sourceId: string; embedding: string }>;
          vector = candidateRows
            .map((row) => ({
              id: row.id,
              sourceId: row.sourceId,
              score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding) as number[]),
            }))
            .sort((left, right) => right.score - left.score)
            .slice(0, 40);
        }
      }
    } catch {
      vector = [];
    }

    const fused = reciprocalRankFusion([lexical, vector], { limit: 8, sourceLimit: 3 });
    const byId = new Map(lexicalRows.map((row) => [row.id, row]));
    if (vector.length > 0) {
      const missing = fused
        .filter((candidate) => !byId.has(candidate.id))
        .map((candidate) => candidate.id);
      const lookup = this.database.sqlite.prepare(`
        SELECT chunks.id, chunks.source_id AS sourceId, sources.name AS sourceName,
               chunks.location_id AS locationId, source_locations.locator,
               chunks.content, chunks.embedding
        FROM chunks
        JOIN sources ON sources.id = chunks.source_id
        JOIN source_locations ON source_locations.id = chunks.location_id
        WHERE chunks.id = ?
      `);
      for (const id of missing) {
        const row = lookup.get(id) as ChunkRow | undefined;
        if (row) byId.set(id, row);
      }
    }

    const citations: Citation[] = [];
    let usedTokens = 0;
    for (const candidate of fused) {
      const row = byId.get(candidate.id);
      if (!row) continue;
      const tokens = estimateTokens(row.content);
      if (citations.length > 0 && usedTokens + tokens > tokenBudget) continue;
      usedTokens += tokens;
      citations.push({
        id: crypto.randomUUID(),
        sourceId: row.sourceId,
        sourceName: row.sourceName,
        locationId: row.locationId,
        locator: row.locator,
        chunkId: row.id,
        excerpt: row.content,
        evidenceStatus: 'supported',
        available: true,
        unavailabilityReason: null,
      });
    }
    return citations;
  }
}
