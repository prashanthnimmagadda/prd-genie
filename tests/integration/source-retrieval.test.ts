import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/server/config.js';
import type { AppDatabase } from '../../src/server/db/client.js';
import { createDatabase } from '../../src/server/db/client.js';
import { Repository } from '../../src/server/db/repository.js';
import { ensureVerifiedBinary, SourceService } from '../../src/server/documents/source-service.js';
import { RetrievalService } from '../../src/server/retrieval/retrieval-service.js';
import type { EmbeddingService } from '../../src/server/retrieval/embedding-service.js';
import { ActionService } from '../../src/server/providers/action-service.js';
import type { ProviderService } from '../../src/server/providers/provider-service.js';

describe('source lifecycle and retrieval fallback', () => {
  let database: AppDatabase;
  let repository: Repository;
  let directory: string;
  let originalSourceDir: string;
  const unavailableEmbeddings = {
    embed: () => Promise.reject(new Error('model unavailable')),
  } as unknown as EmbeddingService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    repository = new Repository(database);
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-source-'));
    originalSourceDir = config.sourceDir;
    Object.assign(config, { sourceDir: directory });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(config, { sourceDir: originalSourceDir });
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('stores, chunks, retrieves, deduplicates, and deletes a Markdown source', async () => {
    const project = repository.createProject('Search', '');
    const service = new SourceService(database, unavailableEmbeddings);
    const source = await service.add(
      project.id,
      'research.md',
      Buffer.from(
        '# Interviews\n\nParticipants lose work after refreshing the browser. ' +
          'They need automatic recovery and a visible saved state.\n\n' +
          '## Constraints\n\nRecovery must work without a network connection.',
      ),
    );
    expect(source.status).toBe('processing');
    await expect.poll(() => repository.listSources(project.id)[0]?.status).toBe('partial');
    expect(fs.existsSync(path.join(directory, `${source.hash}.md`))).toBe(true);
    expect(repository.listSources(project.id)).toHaveLength(1);

    const retrieval = new RetrievalService(database, unavailableEmbeddings);
    const results = await retrieval.retrieve(project.id, 'automatic recovery offline');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      sourceId: source.id,
      sourceName: 'research.md',
      evidenceStatus: 'supported',
    });

    expect(service.retry(project.id, source.id)).toMatchObject({ status: 'processing' });
    await expect.poll(() => repository.listSources(project.id)[0]?.status).toBe('partial');

    await expect(
      service.add(
        project.id,
        'copy.md',
        Buffer.from(
          '# Interviews\n\nParticipants lose work after refreshing the browser. ' +
            'They need automatic recovery and a visible saved state.\n\n' +
            '## Constraints\n\nRecovery must work without a network connection.',
        ),
      ),
    ).rejects.toMatchObject({ code: 'duplicate_source' });

    Object.assign(database, { vectorAvailable: false });
    repository.deleteSource(project.id, source.id);
    expect(repository.listSources(project.id)).toHaveLength(0);
    expect(fs.readdirSync(directory)).toHaveLength(0);
    expect(() => repository.deleteSource(project.id, source.id)).toThrow('Source not found');
  });

  it('cancels pending binary cleanup when the same content is uploaded again', async () => {
    const project = repository.createProject('Cleanup cancellation', '');
    const service = new SourceService(database, unavailableEmbeddings);
    const content = Buffer.from('Reusable evidence remains referenced after a cleanup retry.');
    const hash = createHash('sha256').update(content).digest('hex');
    const binaryPath = path.join(directory, `${hash}.txt`);
    fs.writeFileSync(binaryPath, content);
    database.sqlite
      .prepare(
        `INSERT INTO pending_file_deletions
         (binary_path, created_at, attempts, last_error_code, last_attempt_at)
         VALUES (?, ?, 1, 'EPERM', ?)`,
      )
      .run(binaryPath, new Date().toISOString(), new Date().toISOString());

    await service.add(project.id, 'reused.txt', content);

    expect(repository.pendingFileDeletionCount()).toBe(0);
    expect(fs.existsSync(binaryPath)).toBe(true);
  });

  it('repairs a corrupt content-addressed binary before storing a source reference', async () => {
    const project = repository.createProject('Binary verification', '');
    const service = new SourceService(database, unavailableEmbeddings);
    const content = Buffer.from('Verified evidence bytes are retained for every shared reference.');
    const hash = createHash('sha256').update(content).digest('hex');
    const binaryPath = path.join(directory, `${hash}.txt`);
    fs.writeFileSync(binaryPath, Buffer.from('corrupt'));

    const source = await service.add(project.id, 'verified.txt', content);

    expect(source.hash).toBe(hash);
    expect(fs.readFileSync(binaryPath)).toEqual(content);
    expect(fs.statSync(binaryPath).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('reuses and verifies a binary created by a concurrent first writer', () => {
    const content = Buffer.from('Concurrent identical evidence bytes.');
    const hash = createHash('sha256').update(content).digest('hex');
    const binaryPath = path.join(directory, `${hash}.txt`);
    const writeFileSync = fs.writeFileSync.bind(fs);
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((target, data, options) => {
      writeFileSync(target, data, options);
      const error = new Error('already exists') as NodeJS.ErrnoException;
      error.code = 'EEXIST';
      throw error;
    });

    expect(ensureVerifiedBinary(binaryPath, content, hash)).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(binaryPath)).toEqual(content);
    expect(fs.statSync(binaryPath).mode & 0o777).toBe(0o600);
  });

  it('rejects empty and oversized source buffers before writing', async () => {
    const project = repository.createProject('Search', '');
    const service = new SourceService(database, unavailableEmbeddings);
    await expect(service.add(project.id, 'empty.txt', Buffer.alloc(0))).rejects.toMatchObject({
      code: 'empty_file',
    });
    await expect(service.add(project.id, 'blank.txt', Buffer.from('   '))).rejects.toMatchObject({
      code: 'empty_document',
    });
    const originalLimit = config.maxUploadBytes;
    Object.assign(config, { maxUploadBytes: 2 });
    await expect(service.add(project.id, 'large.txt', Buffer.from('long'))).rejects.toMatchObject({
      code: 'file_too_large',
    });
    Object.assign(config, { maxUploadBytes: originalLimit });
  });

  it('uses the SQLite vector index and honours the context budget', async () => {
    const project = repository.createProject('Hybrid search', '');
    const service = new SourceService(database, unavailableEmbeddings);
    await service.add(
      project.id,
      'one.md',
      Buffer.from('# Signal\n\nA distinctive recovery signal appears in this evidence paragraph.'),
    );
    const row = database.sqlite
      .prepare('SELECT id FROM chunks WHERE project_id = ?')
      .get(project.id) as { id: string };
    const vector = Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0));
    database.sqlite
      .prepare(
        `UPDATE chunks
         SET embedding = ?, embedding_model = ?, embedding_revision = ?, embedding_dimensions = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(vector), 'synthetic', 'test', 384, row.id);
    database.sqlite
      .prepare('INSERT INTO chunk_vectors (chunk_id, embedding) VALUES (?, ?)')
      .run(row.id, JSON.stringify(vector));
    const available = {
      embed: () => Promise.resolve([vector]),
    } as unknown as EmbeddingService;
    const retrieval = new RetrievalService(database, available);
    const results = await retrieval.retrieve(project.id, 'recovery signal', 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.chunkId).toBe(row.id);
    expect(await retrieval.retrieve(project.id, '!')).toEqual([]);
  });

  it('falls back to stored vectors when the extension is unavailable', async () => {
    const project = repository.createProject('Portable search', '');
    const service = new SourceService(database, unavailableEmbeddings);
    await service.add(
      project.id,
      'portable.txt',
      Buffer.from('Portable semantic evidence supports local recovery.'),
    );
    const row = database.sqlite
      .prepare('SELECT id FROM chunks WHERE project_id = ?')
      .get(project.id) as { id: string };
    const vector = Array.from({ length: 384 }, (_, index) => (index === 1 ? 1 : 0));
    database.sqlite
      .prepare('UPDATE chunks SET embedding = ? WHERE id = ?')
      .run(JSON.stringify(vector), row.id);
    Object.assign(database, { vectorAvailable: false });
    const retrieval = new RetrievalService(database, {
      embed: () => Promise.resolve([vector]),
    } as unknown as EmbeddingService);
    const results = await retrieval.retrieve(project.id, 'semantic evidence');
    expect(results[0]?.chunkId).toBe(row.id);
  });

  it('hydrates semantic-only candidates and skips excerpts beyond the context budget', async () => {
    const project = repository.createProject('Semantic only', '');
    const service = new SourceService(database, unavailableEmbeddings);
    await service.add(
      project.id,
      'semantic.txt',
      Buffer.from('A distinctive zebra observation is recorded for later analysis.'),
    );
    await service.add(
      project.id,
      'lexical-one.txt',
      Buffer.from('Recovery evidence contains enough words to exceed a one token context budget.'),
    );
    await service.add(
      project.id,
      'lexical-two.txt',
      Buffer.from('A second recovery excerpt also exceeds the deliberately tiny context budget.'),
    );
    const vector = Array.from({ length: 384 }, (_, index) => (index === 3 ? 1 : 0));
    const semantic = database.sqlite
      .prepare("SELECT id FROM chunks WHERE content LIKE '%zebra%'")
      .get() as { id: string };
    database.sqlite
      .prepare(
        `UPDATE chunks
         SET embedding = ?, embedding_model = ?, embedding_revision = ?, embedding_dimensions = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(vector), 'synthetic', 'test', 384, semantic.id);
    database.sqlite
      .prepare('INSERT INTO chunk_vectors (chunk_id, embedding) VALUES (?, ?)')
      .run(semantic.id, JSON.stringify(vector));

    const retrieval = new RetrievalService(database, {
      embed: () => Promise.resolve([vector]),
    } as unknown as EmbeddingService);
    const semanticOnly = await retrieval.retrieve(project.id, 'unmatched query');
    expect(semanticOnly.some((citation) => citation.chunkId === semantic.id)).toBe(true);

    const bounded = await retrieval.retrieve(project.id, 'recovery', 1);
    expect(bounded).toHaveLength(1);

    const lexicalOnly = new RetrievalService(database, {
      embed: () => Promise.resolve([]),
    } as unknown as EmbeddingService);
    expect((await lexicalOnly.retrieve(project.id, 'recovery')).length).toBeGreaterThan(0);
  });

  it('indexes valid embeddings and preserves shared binaries until the final reference is deleted', async () => {
    const first = repository.createProject('First', '');
    const second = repository.createProject('Second', '');
    const vector = Array.from({ length: 384 }, (_, index) => (index === 2 ? 1 : 0));
    const embeddings = {
      embed: (texts: string[]) => Promise.resolve(texts.map(() => vector)),
    } as unknown as EmbeddingService;
    const service = new SourceService(database, embeddings);
    const content = Buffer.from('Shared synthetic evidence about reliable draft recovery.');
    const firstSource = await service.add(first.id, 'shared.txt', content);
    const secondSource = await service.add(second.id, 'shared.txt', content);
    await viWaitFor(() => {
      const indexed = database.sqlite
        .prepare('SELECT count(*) AS count FROM chunk_vectors')
        .get() as { count: number };
      return indexed.count === 2;
    });
    const binary = path.join(directory, `${firstSource.hash}.txt`);
    expect(() => repository.deleteSource(second.id, firstSource.id)).toThrow('Source not found');
    repository.deleteSource(first.id, firstSource.id);
    expect(fs.existsSync(binary)).toBe(true);
    repository.deleteSource(second.id, secondSource.id);
    expect(fs.existsSync(binary)).toBe(false);
  });

  it('rolls back action setup when a source is deleted during deferred retrieval', async () => {
    const project = repository.createProject('Delete during retrieval', '');
    const sourceService = new SourceService(database, unavailableEmbeddings);
    const source = await sourceService.add(
      project.id,
      'deferred-evidence.txt',
      Buffer.from('Synthetic evidence supports a deferred retrieval race regression.'),
    );
    await expect.poll(() => repository.listSources(project.id)[0]?.status).toBe('partial');

    let releaseEmbedding: ((vectors: number[][]) => void) | undefined;
    let markEmbeddingStarted: (() => void) | undefined;
    const embeddingStarted = new Promise<void>((resolve) => {
      markEmbeddingStarted = resolve;
    });
    const pendingEmbedding = new Promise<number[][]>((resolve) => {
      releaseEmbedding = resolve;
    });
    const retrieval = new RetrievalService(database, {
      embed: () => {
        markEmbeddingStarted?.();
        return pendingEmbedding;
      },
    } as unknown as EmbeddingService);
    const providers = { model: vi.fn(() => ({ provider: 'synthetic' })) };
    const actions = new ActionService(
      repository,
      retrieval,
      providers as unknown as ProviderService,
    );
    const action = actions.run(
      undefined,
      {
        projectId: project.id,
        revision: 0,
        action: 'ask',
        scope: 'document',
        provider: 'ollama',
        model: 'synthetic',
        instruction: 'Explain the synthetic evidence.',
      },
      new AbortController().signal,
    );

    await embeddingStarted;
    repository.deleteSource(project.id, source.id);
    releaseEmbedding?.([]);

    await expect(action).rejects.toMatchObject({ code: 'stale_evidence' });
    expect(providers.model).toHaveBeenCalledTimes(1);
    expect(repository.listAiRuns(project.id)).toEqual([]);
    expect(
      (
        database.sqlite.prepare('SELECT count(*) AS count FROM citations').get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
  });

  it('removes lexical data and prevents late vectors after project deletion', async () => {
    const project = repository.createProject('Delete while indexing', '');
    const vector = Array.from({ length: 384 }, (_, index) => (index === 4 ? 1 : 0));
    let resolveEmbedding: ((vectors: number[][]) => void) | undefined;
    const pending = new Promise<number[][]>((resolve) => {
      resolveEmbedding = resolve;
    });
    const service = new SourceService(database, {
      embed: () => pending,
    } as unknown as EmbeddingService);
    await service.add(
      project.id,
      'pending.txt',
      Buffer.from('Synthetic evidence is deleted before semantic indexing completes.'),
    );
    expect(
      (
        database.sqlite
          .prepare('SELECT count(*) AS count FROM chunks_fts WHERE project_id = ?')
          .get(project.id) as { count: number }
      ).count,
    ).toBeGreaterThan(0);

    repository.deleteProject(project.id);
    resolveEmbedding?.([vector]);
    await service.close();

    expect(
      (
        database.sqlite
          .prepare('SELECT count(*) AS count FROM chunks_fts WHERE project_id = ?')
          .get(project.id) as { count: number }
      ).count,
    ).toBe(0);
    expect(
      (database.sqlite.prepare('SELECT count(*) AS count FROM chunks').get() as { count: number })
        .count,
    ).toBe(0);
    expect(
      (
        database.sqlite.prepare('SELECT count(*) AS count FROM chunk_vectors').get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
  });

  it('marks malformed embedding output as lexical-only without breaking ingestion', async () => {
    const project = repository.createProject('Malformed vectors', '');
    const service = new SourceService(database, {
      embed: () => Promise.resolve([[1, 2, 3]]),
    } as unknown as EmbeddingService);
    await service.add(
      project.id,
      'evidence.txt',
      Buffer.from('Synthetic evidence remains usable.'),
    );
    await service.close();
    const row = database.sqlite
      .prepare(
        `SELECT chunks.embedding, sources.status, sources.error
         FROM chunks JOIN sources ON sources.id = chunks.source_id
         WHERE chunks.project_id = ?`,
      )
      .get(project.id) as { embedding: string | null; status: string; error: string | null };
    expect(row.embedding).toBeNull();
    expect(row.status).toBe('partial');
    expect(row.error).toContain('Lexical evidence search remains ready');
  });

  it('ignores vector candidates outside the project and missing hydrated rows', async () => {
    const emptyLexical = {
      all: () => [],
    };
    const vectorIndexDatabase = {
      vectorAvailable: true,
      sqlite: {
        prepare: (sql: string) => {
          if (sql.includes('FROM chunks_fts')) return emptyLexical;
          if (sql.includes('FROM chunk_vectors')) {
            return { all: () => [{ id: 'outside-project', distance: 0.1 }] };
          }
          if (sql.includes('SELECT source_id AS sourceId')) return { get: () => undefined };
          throw new Error(`Unexpected SQL in vector-index fixture: ${sql}`);
        },
      },
    } as unknown as AppDatabase;
    const embedding = {
      embed: () => Promise.resolve([[1, 0]]),
    } as unknown as EmbeddingService;
    await expect(
      new RetrievalService(vectorIndexDatabase, embedding).retrieve('project', 'semantic query'),
    ).resolves.toEqual([]);

    const portableDatabase = {
      vectorAvailable: false,
      sqlite: {
        prepare: (sql: string) => {
          if (sql.includes('FROM chunks_fts')) return emptyLexical;
          if (sql.includes('embedding IS NOT NULL')) {
            return {
              all: () => [
                { id: 'missing-row', sourceId: 'source', embedding: JSON.stringify([1, 0]) },
              ],
            };
          }
          if (sql.includes('FROM chunks\n')) return { get: () => undefined };
          throw new Error(`Unexpected SQL in portable fixture: ${sql}`);
        },
      },
    } as unknown as AppDatabase;
    await expect(
      new RetrievalService(portableDatabase, embedding).retrieve('project', 'semantic query'),
    ).resolves.toEqual([]);
  });
});

async function viWaitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for background indexing.');
}
