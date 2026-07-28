import { buildApp } from './app.js';
import { config } from './config.js';

const { app } = await buildApp();

const address = await app.listen({ host: config.host, port: config.port });
app.log.info({ address }, 'PRD Genie is ready');

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Stopping PRD Genie');
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
