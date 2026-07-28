import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { ApiError } from '../shared/api.js';
import { createDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { SourceService } from './documents/source-service.js';
import { ExportService } from './export/export-service.js';
import { ActionService } from './providers/action-service.js';
import { ProviderService } from './providers/provider-service.js';
import { ProposalService } from './providers/proposal-service.js';
import { SessionStore } from './providers/session-store.js';
import { EmbeddingService } from './retrieval/embedding-service.js';
import { RetrievalService } from './retrieval/retrieval-service.js';
import { registerApi } from './routes/api.js';

export async function buildApp(
  options: { databasePath?: string; embeddings?: EmbeddingService } = {},
) {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.apiKey',
          'req.body.headers',
          'res.headers.set-cookie',
        ],
        censor: '[redacted]',
      },
    },
    bodyLimit: 30 * 1024 * 1024,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(multipart, { limits: { files: 1, fileSize: 25 * 1024 * 1024 } });

  app.setErrorHandler((error, request, reply) => {
    const apiError =
      error instanceof ApiError
        ? error
        : new ApiError(500, 'internal_error', 'The request could not be completed.');
    if (!(error instanceof ApiError)) request.log.error({ err: error }, 'Request failed');
    return reply.code(apiError.status).send({
      error: { code: apiError.code, message: apiError.message, requestId: request.id },
    });
  });

  const database = createDatabase(options.databasePath);
  const repository = new Repository(database);
  const embeddings = options.embeddings ?? new EmbeddingService();
  const retrieval = new RetrievalService(database, embeddings);
  const sessions = new SessionStore();
  const providers = new ProviderService(sessions);
  const services = {
    repository,
    embeddings,
    sources: new SourceService(database, embeddings),
    exports: new ExportService(repository, database),
    sessions,
    providers,
    actions: new ActionService(repository, retrieval, providers),
    proposals: new ProposalService(repository),
  };
  registerApi(app, services);

  const clientRoot = path.resolve(process.cwd(), 'dist/client');
  if (fs.existsSync(clientRoot)) {
    await app.register(staticFiles, { root: clientRoot, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({
          error: { code: 'not_found', message: 'API route not found.', requestId: request.id },
        });
      }
      return reply.type('text/html').sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    await embeddings.close();
    database.close();
  });

  return { app, services, database };
}
