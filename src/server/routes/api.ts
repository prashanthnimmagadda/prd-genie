import { Readable } from 'node:stream';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  acceptFindingSchema,
  aiActionSchema,
  applyAiRunSchema,
  projectCreateSchema,
  projectUpdateSchema,
  providerKinds,
  restoreRevisionSchema,
  sectionUpdateSchema,
  sessionProviderSchema,
  type ProviderKind,
} from '../../shared/types.js';
import { ApiError } from '../../shared/api.js';
import { config } from '../config.js';
import type { Repository } from '../db/repository.js';
import type { SourceService } from '../documents/source-service.js';
import { parseDocument } from '../documents/parser.js';
import type { ExportService } from '../export/export-service.js';
import { validateProviderEndpoint } from '../providers/endpoints.js';
import type { ActionService } from '../providers/action-service.js';
import type { ProviderService } from '../providers/provider-service.js';
import type { ProposalService } from '../providers/proposal-service.js';
import type { SessionStore } from '../providers/session-store.js';
import type { EmbeddingService } from '../retrieval/embedding-service.js';

interface Services {
  repository: Repository;
  sources: SourceService;
  exports: ExportService;
  sessions: SessionStore;
  providers: ProviderService;
  actions: ActionService;
  proposals: ProposalService;
  embeddings: EmbeddingService;
}

const sessionCookie = 'prd_genie_session';

export function registerApi(app: FastifyInstance, services: Services): void {
  app.addHook('onRequest', (request, reply, done) => {
    let session = services.sessions.get(request.cookies[sessionCookie]);
    if (!session) {
      session = services.sessions.create();
      reply.setCookie(sessionCookie, session.id, {
        httpOnly: true,
        sameSite: 'strict',
        secure: false,
        path: '/',
      });
    }
    done();
  });
  app.get('/api/health', () => {
    const retrieval = services.embeddings.getStatus();
    return {
      status: retrieval.mode === 'hybrid' ? 'ok' : 'degraded',
      version: config.version,
      retrieval,
    };
  });

  app.get('/api/projects', () => ({ projects: services.repository.listProjects() }));
  app.post('/api/projects/import', async (request, reply) => {
    const part = await request.file({
      limits: { files: 1, fileSize: config.maxUploadBytes },
    });
    if (!part) throw new ApiError(400, 'missing_file', 'Choose a PRD file to import.');
    const parsed = await parseDocument(part.filename, await part.toBuffer());
    if (
      ![
        'text/plain',
        'text/markdown',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ].includes(parsed.mediaType)
    ) {
      throw new ApiError(
        415,
        'unsupported_prd_import',
        'PRD imports support Markdown, DOCX, and plain text.',
      );
    }
    const projectName = path.basename(part.filename, path.extname(part.filename));
    const project = services.repository.createProject(projectName || 'Imported PRD', '');
    const grouped = new Map<string, string[]>();
    for (const location of parsed.locations) {
      const title = location.heading ?? 'Imported PRD';
      const body = location.content.replace(/^#{1,6}\s+.+\n?/, '').trim();
      grouped.set(title, [...(grouped.get(title) ?? []), body]);
    }
    const sections = [...grouped.entries()].map(([title, bodies], position) => ({
      id: crypto.randomUUID(),
      projectId: project.id,
      title,
      body: bodies.filter(Boolean).join('\n\n'),
      position,
      updatedAt: new Date().toISOString(),
    }));
    const prd = services.repository.savePrd(
      project.id,
      0,
      sections.length > 0
        ? sections
        : [
            {
              id: crypto.randomUUID(),
              projectId: project.id,
              title: 'Imported PRD',
              body: '',
              position: 0,
              updatedAt: new Date().toISOString(),
            },
          ],
      'PRD imported',
    );
    return reply.code(201).send({ project: services.repository.getProject(project.id), prd });
  });
  app.post('/api/projects', (request, reply) => {
    const body = parse(projectCreateSchema, request.body);
    return reply.code(201).send(services.repository.createProject(body.name, body.description));
  });
  app.get('/api/projects/:id', (request) => {
    const { id } = request.params as { id: string };
    return services.repository.getProject(id);
  });
  app.patch('/api/projects/:id', (request) => {
    const { id } = request.params as { id: string };
    const body = parse(projectUpdateSchema, request.body);
    return services.repository.updateProject(id, body);
  });
  app.delete('/api/projects/:id', (request, reply) => {
    const { id } = request.params as { id: string };
    services.repository.deleteProject(id);
    return reply.code(204).send();
  });

  app.get('/api/projects/:id/prd', (request) => {
    const { id } = request.params as { id: string };
    return services.repository.getPrd(id);
  });
  app.put('/api/projects/:id/prd', (request) => {
    const { id } = request.params as { id: string };
    const body = parse(sectionUpdateSchema, request.body);
    return services.repository.savePrd(id, body.revision, body.sections, body.reason);
  });
  app.get('/api/projects/:id/revisions', (request) => {
    const { id } = request.params as { id: string };
    return { revisions: services.repository.listRevisions(id) };
  });
  app.post('/api/projects/:id/revisions/:revision/restore', (request) => {
    const { id, revision } = request.params as { id: string; revision: string };
    const targetRevision = Number.parseInt(revision, 10);
    if (!Number.isSafeInteger(targetRevision) || targetRevision < 0) {
      throw new ApiError(400, 'invalid_revision', 'Revision must be a non-negative integer.');
    }
    const body = parse(restoreRevisionSchema, request.body);
    return services.repository.restoreRevision(id, targetRevision, body.expectedRevision);
  });

  app.get('/api/projects/:id/sources', (request) => {
    const { id } = request.params as { id: string };
    return { sources: services.repository.listSources(id) };
  });
  app.post('/api/projects/:id/sources', async (request, reply) => {
    const { id } = request.params as { id: string };
    services.repository.getProject(id);
    const part = await request.file({
      limits: { files: 1, fileSize: config.maxUploadBytes },
    });
    if (!part) throw new ApiError(400, 'missing_file', 'Choose a source file to upload.');
    const buffer = await part.toBuffer();
    const source = await services.sources.add(id, part.filename, buffer);
    return reply.code(201).send(source);
  });
  app.delete('/api/projects/:projectId/sources/:sourceId', (request, reply) => {
    const { projectId, sourceId } = request.params as { projectId: string; sourceId: string };
    services.repository.deleteSource(projectId, sourceId);
    return reply.code(204).send();
  });
  app.get('/api/projects/:projectId/sources/:sourceId/locations/:locationId', (request) => {
    const { sourceId, locationId } = request.params as {
      projectId: string;
      sourceId: string;
      locationId: string;
    };
    return services.repository.getLocation(sourceId, locationId);
  });

  app.get('/api/session/providers', (request) => {
    const id = request.cookies[sessionCookie];
    return {
      providers: providerKinds.map((provider) => services.sessions.state(id, provider)),
    };
  });
  app.put('/api/session/providers/:provider', (request) => {
    const provider = providerParam(request);
    const body = parse(sessionProviderSchema, request.body);
    const sessionId = request.cookies[sessionCookie];
    if (!sessionId) throw new ApiError(401, 'session_missing', 'Browser session is unavailable.');
    const baseUrl = body.baseUrl ? validateProviderEndpoint(body.baseUrl) : undefined;
    services.sessions.setProvider(sessionId, provider, {
      ...(body.apiKey ? { apiKey: body.apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(body.headers ? { headers: body.headers } : {}),
    });
    return services.sessions.state(sessionId, provider);
  });
  app.delete('/api/session/providers/:provider', (request, reply) => {
    const provider = providerParam(request);
    const sessionId = request.cookies[sessionCookie];
    if (sessionId) services.sessions.clearProvider(sessionId, provider);
    return reply.code(204).send();
  });
  app.get('/api/providers/:provider/models', async (request) => {
    const provider = providerParam(request);
    const models = await services.providers.listModels(
      request.cookies[sessionCookie],
      provider,
      request.signal,
    );
    return { models };
  });

  app.post('/api/ai/actions', async (request, reply) => {
    const body = parse(aiActionSchema, request.body);
    const controller = new AbortController();
    request.raw.once('aborted', () => controller.abort());
    reply.raw.once('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    const response = await services.actions.run(
      request.cookies[sessionCookie],
      body,
      controller.signal,
    );
    return sendWebResponse(reply, response);
  });
  app.post('/api/projects/:projectId/ai-runs/:runId/apply', (request) => {
    const { projectId, runId } = request.params as { projectId: string; runId: string };
    const body = parse(applyAiRunSchema, request.body);
    return services.proposals.apply(projectId, runId, body.revision, body.proposedMarkdown);
  });

  app.get('/api/projects/:id/review-findings', (request) => {
    const { id } = request.params as { id: string };
    return { findings: services.repository.listFindings(id) };
  });
  app.patch('/api/projects/:projectId/review-findings/:findingId', (request) => {
    const { projectId, findingId } = request.params as {
      projectId: string;
      findingId: string;
    };
    const body = request.body as { status?: unknown };
    if (body.status !== 'dismissed') {
      throw new ApiError(400, 'invalid_status', 'Use the accept endpoint to apply a finding.');
    }
    services.repository.setFindingStatus(projectId, findingId, 'dismissed');
    return { ok: true };
  });
  app.post('/api/projects/:projectId/review-findings/:findingId/accept', (request) => {
    const { projectId, findingId } = request.params as {
      projectId: string;
      findingId: string;
    };
    const body = parse(acceptFindingSchema, request.body);
    return services.repository.acceptFinding(
      projectId,
      findingId,
      body.revision,
      body.proposedMarkdown,
    );
  });

  app.get('/api/projects/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { format = 'markdown' } = request.query as { format?: string };
    const result = await services.exports.create(id, format);
    return reply
      .header('content-type', result.mediaType)
      .header('content-disposition', `attachment; filename="${result.filename}"`)
      .send(result.body);
  });
}

function parse<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'invalid_request', 'Request validation failed.');
  return result.data;
}

function providerParam(request: FastifyRequest): ProviderKind {
  const { provider } = request.params as { provider: string };
  if (!providerKinds.includes(provider as ProviderKind)) {
    throw new ApiError(404, 'provider_not_found', 'Provider not found.');
  }
  return provider as ProviderKind;
}

function sendWebResponse(reply: FastifyReply, response: Response) {
  for (const [name, value] of response.headers) reply.header(name, value);
  reply.code(response.status);
  if (!response.body) return reply.send();
  return reply.send(Readable.fromWeb(response.body as never));
}
