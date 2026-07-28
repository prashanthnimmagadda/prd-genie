import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../../src/server/app.js';
import { config } from '../../src/server/config.js';
import type { EmbeddingService } from '../../src/server/retrieval/embedding-service.js';
import type { AppDatabase } from '../../src/server/db/client.js';
import type { Repository } from '../../src/server/db/repository.js';

describe('API', () => {
  let app: FastifyInstance;
  let sourceDir: string;
  let originalSourceDir: string;
  let database: AppDatabase;
  let repository: Repository;

  beforeEach(async () => {
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-api-'));
    originalSourceDir = config.sourceDir;
    Object.assign(config, { sourceDir });
    const embeddings = {
      getStatus: () => ({
        mode: 'lexical',
        model: 'synthetic',
        revision: 'test',
        detail: 'Unavailable in test',
      }),
      embed: () => Promise.reject(new Error('Unavailable in test')),
      close: () => Promise.resolve(),
    } as unknown as EmbeddingService;
    const built = await buildApp({ databasePath: ':memory:', embeddings });
    app = built.app;
    database = built.database;
    repository = built.services.repository;
  });

  afterEach(async () => {
    await app.close();
    Object.assign(config, { sourceDir: originalSourceDir });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it('creates and reads a project without authentication', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Search', description: 'Improve relevance' },
    });
    expect(created.statusCode).toBe(201);
    const project = created.json<{ id: string }>();
    const prd = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/prd` });
    expect(prd.statusCode).toBe(200);
    expect(prd.json<{ sections: unknown[] }>().sections).toHaveLength(13);
  });

  it('reports lexical degradation before the embedding model is initialised', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'degraded',
      version: '0.1.0-rc.1',
      retrieval: { mode: 'lexical' },
    });
  });

  it('keeps session credentials opaque and clearable', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/session/providers' });
    const cookie = first.cookies[0]?.name + '=' + first.cookies[0]?.value;
    const configured = await app.inject({
      method: 'PUT',
      url: '/api/session/providers/openai',
      headers: { cookie },
      payload: { apiKey: ['synthetic', 'session', 'value', 'for', 'test'].join('-') },
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.body).not.toContain('synthetic-session-value');
    expect(configured.json()).toMatchObject({
      configured: true,
      credentialSource: 'session',
    });
    const cleared = await app.inject({
      method: 'DELETE',
      url: '/api/session/providers/openai',
      headers: { cookie },
    });
    expect(cleared.statusCode).toBe(204);
  });

  it('uses typed 4xx errors for invalid requests and missing credentials', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'invalid_request' } });

    const models = await app.inject({ method: 'GET', url: '/api/providers/openai/models' });
    expect(models.statusCode).toBe(401);
    expect(models.json()).toMatchObject({ error: { code: 'missing_credentials' } });
  });

  it('updates PRD revisions, project preferences, and exports', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Import', description: '' },
    });
    const project = created.json<{ id: string }>();
    const initial = (
      await app.inject({ method: 'GET', url: `/api/projects/${project.id}/prd` })
    ).json<{ revision: number; sections: Array<Record<string, unknown>> }>();
    initial.sections[0] = { ...initial.sections[0], body: 'A synthetic problem statement.' };
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/prd`,
      payload: { revision: 0, sections: initial.sections, reason: 'Test edit' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<{ revision: number }>().revision).toBe(1);
    const stale = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/prd`,
      payload: { revision: 0, sections: initial.sections, reason: 'Stale edit' },
    });
    expect(stale.statusCode).toBe(409);
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      payload: { selectedProvider: 'ollama', selectedModel: 'local-test' },
    });
    expect(updated.json()).toMatchObject({ selectedProvider: 'ollama' });
    const revisions = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/revisions`,
    });
    expect(revisions.json<{ revisions: unknown[] }>().revisions).toHaveLength(2);
    const markdown = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/export?format=markdown`,
    });
    expect(markdown.statusCode).toBe(200);
    expect(markdown.body).toContain('synthetic problem');
  });

  it('imports a Markdown PRD and indexes a synthetic source', async () => {
    const imported = await app.inject({
      method: 'POST',
      url: '/api/projects/import',
      headers: { 'content-type': 'multipart/form-data; boundary=test-boundary' },
      payload: multipart('brief.md', '# Problem\n\nDrafts are lost.\n\n## Goal\n\nRecover drafts.'),
    });
    expect(imported.statusCode).toBe(201);
    const project = imported.json<{ project: { id: string }; prd: { sections: unknown[] } }>();
    expect(project.prd.sections).toHaveLength(2);

    const source = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.project.id}/sources`,
      headers: { 'content-type': 'multipart/form-data; boundary=test-boundary' },
      payload: multipart('evidence.txt', 'Five participants asked for automatic recovery.'),
    });
    expect(source.statusCode).toBe(201);
    const sourceId = source.json<{ id: string }>().id;
    const listed = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.project.id}/sources`,
    });
    expect(listed.json<{ sources: unknown[] }>().sources).toHaveLength(1);
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.project.id}/sources/${sourceId}`,
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('updates, reads, and deletes a project through its lifecycle', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Lifecycle', description: '' },
    });
    const project = created.json<{ id: string }>();
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      payload: { name: 'Lifecycle updated', description: 'Synthetic project' },
    });
    expect(updated.json()).toMatchObject({ name: 'Lifecycle updated' });
    const read = await app.inject({ method: 'GET', url: `/api/projects/${project.id}` });
    expect(read.statusCode).toBe(200);
    const removed = await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` });
    expect(removed.statusCode).toBe(204);
    const missing = await app.inject({ method: 'GET', url: `/api/projects/${project.id}` });
    expect(missing.statusCode).toBe(404);
  });

  it('validates provider names, endpoint transport, and session reuse', async () => {
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/providers/not-a-provider/models',
    });
    expect(unknown.statusCode).toBe(404);
    const first = await app.inject({ method: 'GET', url: '/api/session/providers' });
    const cookie = first.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
    const insecure = await app.inject({
      method: 'PUT',
      url: '/api/session/providers/openai-compatible',
      headers: { cookie },
      payload: { baseUrl: 'http://models.example.test/v1', apiKey: 'synthetic' },
    });
    expect(insecure.statusCode).toBe(400);
    const local = await app.inject({
      method: 'PUT',
      url: '/api/session/providers/ollama',
      headers: { cookie },
      payload: { baseUrl: 'http://127.0.0.1:11434/v1' },
    });
    expect(local.json()).toMatchObject({ configured: true, credentialSource: 'session' });
    const reused = await app.inject({
      method: 'GET',
      url: '/api/session/providers',
      headers: { cookie },
    });
    expect(reused.cookies).toHaveLength(0);
  });

  it('opens exact source locations and validates review finding transitions', async () => {
    const project = repository.createProject('Evidence', '');
    const source = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/sources`,
      headers: { 'content-type': 'multipart/form-data; boundary=test-boundary' },
      payload: multipart('evidence.txt', 'Synthetic evidence supports recovery.'),
    });
    const sourceId = source.json<{ id: string }>().id;
    const location = database.sqlite
      .prepare('SELECT id FROM source_locations WHERE source_id = ?')
      .get(sourceId) as { id: string };
    const opened = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/sources/${sourceId}/locations/${location.id}`,
    });
    expect(opened.json()).toMatchObject({ locator: 'Paragraph 1' });
    const missingLocation = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/sources/${sourceId}/locations/${crypto.randomUUID()}`,
    });
    expect(missingLocation.statusCode).toBe(404);

    const runId = repository.createAiRun({
      projectId: project.id,
      action: 'review',
      scope: 'document',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
    });
    const sectionId = repository.getPrd(project.id).sections[0]!.id;
    const finding = repository.storeFinding({
      aiRunId: runId,
      projectId: project.id,
      category: 'clarity',
      severity: 'info',
      targetSectionId: sectionId,
      rationale: 'Clarify the actor.',
      citationIds: [],
      proposedPatch: {
        sectionId,
        beforeMarkdown: '',
        afterMarkdown: 'The actor is the product manager.',
      },
      sourceRevision: 0,
    });
    const listed = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/review-findings`,
    });
    expect(listed.json<{ findings: unknown[] }>().findings).toHaveLength(1);
    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/review-findings/${finding.id}`,
      payload: { status: 'unknown' },
    });
    expect(invalid.statusCode).toBe(400);
    const legacyAccepted = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/review-findings/${finding.id}`,
      payload: { status: 'accepted' },
    });
    expect(legacyAccepted.statusCode).toBe(400);
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/review-findings/${finding.id}/accept`,
      payload: { revision: 0, proposedMarkdown: 'The actor is a working product manager.' },
    });
    expect(accepted.statusCode).toBe(200);
    const acceptedBody = accepted.json<{
      revision: number;
      sections: Array<{ body: string }>;
    }>();
    expect(acceptedBody.revision).toBe(1);
    expect(
      acceptedBody.sections.some(
        (section) => section.body === 'The actor is a working product manager.',
      ),
    ).toBe(true);
  });
});

function multipart(filename: string, content: string): Buffer {
  return Buffer.from(
    [
      '--test-boundary',
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: application/octet-stream',
      '',
      content,
      '--test-boundary--',
      '',
    ].join('\r\n'),
  );
}
