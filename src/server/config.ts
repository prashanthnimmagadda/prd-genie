import path from 'node:path';
import envPaths from 'env-paths';

const defaults = envPaths('prd-genie');
const dataDir = path.resolve(process.env.PRD_GENIE_DATA_DIR ?? defaults.data);
const loopbackHosts = new Set(['127.0.0.1', '::1']);
const loopbackRequestHostnames = new Set(['127.0.0.1', '[::1]', 'localhost']);

export function resolveServerHost(host: string, isContainer: boolean): string {
  if (loopbackHosts.has(host)) return host;
  if (isContainer && host === '0.0.0.0') return host;

  throw new Error(
    'PRD_GENIE_HOST must be 127.0.0.1 or ::1. 0.0.0.0 is allowed only when PRD_GENIE_CONTAINER=1.',
  );
}

export function isAllowedRequestHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    return loopbackRequestHostnames.has(new URL(`http://${hostHeader}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isAllowedBrowserOrigin(
  originHeader: string | undefined,
  hostHeader: string | undefined,
): boolean {
  if (!originHeader) return true;
  if (!hostHeader || !isAllowedRequestHost(hostHeader)) return false;
  try {
    const origin = new URL(originHeader);
    return (
      (origin.protocol === 'http:' || origin.protocol === 'https:') &&
      loopbackRequestHostnames.has(origin.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export const config = {
  version: process.env.npm_package_version ?? '0.1.0-rc.3',
  host: resolveServerHost(
    process.env.PRD_GENIE_HOST ?? '127.0.0.1',
    process.env.PRD_GENIE_CONTAINER === '1',
  ),
  port: Number.parseInt(process.env.PRD_GENIE_PORT ?? '3210', 10),
  dataDir,
  databasePath: path.join(dataDir, 'prd-genie.sqlite'),
  sourceDir: path.join(dataDir, 'sources'),
  modelCacheDir: path.resolve(
    process.env.PRD_GENIE_MODEL_CACHE_DIR ?? path.join(dataDir, 'models'),
  ),
  sessionIdleMs: 8 * 60 * 60 * 1000,
  maxUploadBytes: 25 * 1024 * 1024,
  maxArchiveBytes: 250 * 1024 * 1024,
  maxArchiveManifestBytes: 225 * 1024 * 1024,
  maxDocxEntries: 5_000,
  maxDocxExpandedBytes: 100 * 1024 * 1024,
  maxPdfPages: 200,
  maxPdfExtractedTextChars: 2 * 1024 * 1024,
  pdfParseTimeoutMs: 15_000,
} as const;

export const embeddingModel = {
  id: 'Xenova/all-MiniLM-L6-v2',
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  dimensions: 384,
  license: 'Apache-2.0',
} as const;
