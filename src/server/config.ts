import path from 'node:path';
import envPaths from 'env-paths';

const defaults = envPaths('prd-genie');
const dataDir = path.resolve(process.env.PRD_GENIE_DATA_DIR ?? defaults.data);

export const config = {
  host: process.env.PRD_GENIE_HOST ?? '127.0.0.1',
  port: Number.parseInt(process.env.PRD_GENIE_PORT ?? '3210', 10),
  dataDir,
  databasePath: path.join(dataDir, 'prd-genie.sqlite'),
  sourceDir: path.join(dataDir, 'sources'),
  modelCacheDir: path.resolve(
    process.env.PRD_GENIE_MODEL_CACHE_DIR ?? path.join(dataDir, 'models'),
  ),
  sessionIdleMs: 8 * 60 * 60 * 1000,
  maxUploadBytes: 25 * 1024 * 1024,
} as const;

export const embeddingModel = {
  id: 'Xenova/all-MiniLM-L6-v2',
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  dimensions: 384,
  license: 'Apache-2.0',
} as const;
