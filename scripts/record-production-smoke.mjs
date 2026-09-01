import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-production-smoke-'));
const port = Number.parseInt(process.env.PRD_GENIE_SMOKE_PORT ?? '43210', 10);
const baseUrl = `http://127.0.0.1:${port}`;
const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
let child;
let logs = '';

async function start() {
  child = spawn(process.execPath, ['dist/server/server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PRD_GENIE_DATA_DIR: dataDirectory,
      PRD_GENIE_PORT: String(port),
      PRD_GENIE_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Production server exited early: ${logs}`);
    try {
      const response = await globalThis.fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Retry only this exact temporary server while it starts.
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }
  throw new Error('Production server did not become healthy in time.');
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((_, reject) =>
      globalThis.setTimeout(
        () => reject(new Error('Production server did not stop after SIGTERM.')),
        10_000,
      ),
    ),
  ]);
}

const startedAt = new Date().toISOString();
const checks = {
  health: false,
  client: false,
  projectCreated: false,
  markdownExport: false,
  persistenceAfterRestart: false,
  gracefulSigterm: false,
  cleanupComplete: false,
};
let failure = null;
try {
  await start();
  checks.health = (await globalThis.fetch(`${baseUrl}/api/health`)).ok;
  const client = await globalThis.fetch(baseUrl);
  checks.client = client.ok && (await client.text()).includes('<div id="root">');
  const created = await globalThis.fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Production smoke project', description: 'Synthetic fixture' }),
  });
  const project = await created.json();
  checks.projectCreated = created.ok && typeof project.id === 'string';
  const exported = await globalThis.fetch(
    `${baseUrl}/api/projects/${project.id}/export?format=markdown`,
  );
  checks.markdownExport =
    exported.ok && (await exported.text()).includes('# Production smoke project');
  await stop();
  checks.gracefulSigterm = child?.exitCode === 0;
  await start();
  const projects = await (await globalThis.fetch(`${baseUrl}/api/projects`)).json();
  checks.persistenceAfterRestart =
    Array.isArray(projects.projects) &&
    projects.projects.some((candidate) => candidate.id === project.id);
  await stop();
  checks.gracefulSigterm &&= child?.exitCode === 0;
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  try {
    await stop();
  } catch (error) {
    failure ??= error instanceof Error ? error.message : String(error);
  }
  fs.rmSync(dataDirectory, { recursive: true, force: true });
  checks.cleanupComplete = !fs.existsSync(dataDirectory);
}

const passed = failure === null && Object.values(checks).every(Boolean);
const report = {
  schemaVersion: 1,
  startedAt,
  completedAt: new Date().toISOString(),
  git: {
    sha: git(['rev-parse', 'HEAD']),
    clean: git(['status', '--porcelain=v1']).length === 0,
  },
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  port,
  command: 'node dist/server/server/index.js',
  childPidRecorded: typeof child?.pid === 'number',
  passed,
  checks,
  failure,
};
const reportDirectory = path.join(root, 'reports');
fs.mkdirSync(reportDirectory, { recursive: true });
fs.writeFileSync(
  path.join(reportDirectory, 'production-smoke.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  passed ? 'Production compiled-runtime smoke passed.' : `Production smoke failed: ${failure}`,
);
process.exitCode = passed ? 0 : 1;
