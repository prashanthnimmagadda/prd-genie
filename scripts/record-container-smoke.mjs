import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { parseContainerSystemStatus, validateContainerSmokeReport } from './provenance-policy.mjs';

const root = path.resolve(import.meta.dirname, '..');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const run = (args) =>
  execFileSync('container', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  }).trim();
const json = (args) => JSON.parse(run(args));
const gitSha = git(['rev-parse', 'HEAD']);
const clean = git(['status', '--porcelain=v1']).length === 0;
if (!clean) throw new Error('Container smoke evidence requires a clean working tree.');

const suffix = gitSha.slice(0, 12);
const imageReference = `prd-genie:smoke-${suffix}`;
const containerName = `prd-genie-smoke-${suffix}`;
const dataVolume = `prd-genie-data-${suffix}`;
const modelVolume = `prd-genie-models-${suffix}`;
const volumeNames = [dataVolume, modelVolume];
const port = await reserveLoopbackPort();

if (systemStatus() === 'running') {
  throw new Error('Apple Container must be stopped before the isolated smoke test.');
}

let systemStarted = false;
let containerCreated = false;
let imageCreated = false;
const volumesCreated = new Set();

try {
  systemStarted = true;
  run(['system', 'start', '--disable-kernel-install', '--timeout', '30']);
  assertResourcesAbsent();

  run([
    'build',
    '--platform',
    'linux/arm64',
    '--build-arg',
    `GIT_REVISION=${gitSha}`,
    '--tag',
    imageReference,
    root,
  ]);
  imageCreated = true;
  const image = inspectBuiltImage();

  for (const volume of volumeNames) {
    run(['volume', 'create', volume]);
    volumesCreated.add(volume);
  }
  run([
    'run',
    '--detach',
    '--name',
    containerName,
    '--publish',
    `127.0.0.1:${port}:3210`,
    '--volume',
    `${dataVolume}:/data`,
    '--volume',
    `${modelVolume}:/models`,
    imageReference,
  ]);
  containerCreated = true;

  const health = await waitForHealth();
  const invalidHost = await request({ path: '/api/health', host: 'private.example' });
  if (invalidHost.statusCode !== 421) {
    throw new Error(`Invalid Host returned ${invalidHost.statusCode}, expected 421.`);
  }

  const processStatus = run(['exec', containerName, 'cat', '/proc/1/status']);
  const runtimeUid = Number(/^Uid:\s+(\d+)/m.exec(processStatus)?.[1]);
  const commandLine = run(['exec', containerName, 'cat', '/proc/1/cmdline']).replaceAll('\0', ' ');
  if (runtimeUid !== 1000 || !commandLine.includes('node')) {
    throw new Error('The application is not running as unprivileged Node PID 1.');
  }

  const created = await request({
    method: 'POST',
    path: '/api/projects',
    body: { name: `Container smoke ${suffix}`, description: 'Synthetic persistence check' },
  });
  if (created.statusCode !== 201 || typeof created.body?.id !== 'string') {
    throw new Error('The container smoke project could not be created.');
  }
  const projectId = created.body.id;

  const stopStarted = performance.now();
  run(['stop', '--signal', 'SIGTERM', '--time', '10', containerName]);
  const stopMilliseconds = Math.round(performance.now() - stopStarted);
  const shutdownLog = run(['logs', containerName]);
  if (!shutdownLog.includes('Stopping PRD Genie') || !shutdownLog.includes('SIGTERM')) {
    throw new Error('Container logs do not prove graceful SIGTERM handling.');
  }

  run(['start', containerName]);
  await waitForHealth();
  const projects = await request({ path: '/api/projects' });
  const projectIdAfterRestart = Array.isArray(projects.body?.projects)
    ? projects.body.projects.find((project) => project?.id === projectId)?.id
    : undefined;
  if (projectIdAfterRestart !== projectId) {
    throw new Error('The synthetic project did not persist across container restart.');
  }

  run(['stop', '--signal', 'SIGTERM', '--time', '10', containerName]);
  run(['delete', containerName]);
  containerCreated = false;
  for (const volume of volumeNames) {
    run(['volume', 'delete', volume]);
    volumesCreated.delete(volume);
  }
  run(['image', 'delete', imageReference]);
  imageCreated = false;
  assertResourcesAbsent();

  const versions = json(['system', 'version', '--format', 'json']);
  const cliVersion = Array.isArray(versions)
    ? versions.find((entry) => entry?.appName === 'container')?.version
    : undefined;
  if (typeof cliVersion !== 'string' || !cliVersion.trim()) {
    throw new Error('Apple Container version could not be determined.');
  }

  run(['system', 'stop']);
  systemStarted = false;
  if (systemStatus() === 'running') {
    throw new Error('Apple Container did not return to its stopped state.');
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    git: { sha: gitSha, clean: true },
    engine: { name: 'Apple Container', version: cliVersion.trim(), platform: 'linux/arm64' },
    image,
    resources: { containerName, volumeNames: [...volumeNames].sort() },
    checks: {
      health: true,
      healthStatus: health.body.status,
      pendingFileCleanup: health.body.fileCleanup.pending,
      invalidHostStatus: invalidHost.statusCode,
      runtimeUid,
      runtimePid: 1,
      persistenceAfterRestart: projectIdAfterRestart === projectId,
      gracefulSigterm: true,
      shutdownSignal: 'SIGTERM',
      stopMilliseconds,
      shutdownLogSha256: createHash('sha256').update(shutdownLog).digest('hex'),
      cleanupComplete: true,
    },
  };
  if (!validateContainerSmokeReport(report, gitSha)) {
    throw new Error('The observed container smoke result does not satisfy release policy.');
  }

  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'reports/container-smoke.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`Recorded automated Apple Container smoke evidence for ${gitSha}.`);
} catch (error) {
  const cleanupError = cleanupAfterFailure();
  if (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      'Container smoke test and cleanup both failed.',
      { cause: error },
    );
  }
  throw error;
}

function inspectBuiltImage() {
  const images = json(['image', 'list', '--format', 'json']);
  const record = Array.isArray(images)
    ? images.find((candidate) => candidate?.configuration?.name === imageReference)
    : undefined;
  const variant = record?.variants?.find(
    (candidate) =>
      candidate?.platform?.os === 'linux' && candidate?.platform?.architecture === 'arm64',
  );
  const labels = variant?.config?.config?.Labels ?? variant?.config?.config?.labels;
  const revision = labels?.['org.opencontainers.image.revision'];
  const digest = record?.configuration?.descriptor?.digest;
  if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? '') || revision !== gitSha) {
    throw new Error('The built image digest or OCI source revision is invalid.');
  }
  return { reference: imageReference, digest, revision };
}

function systemStatus() {
  const result = spawnSync('container', ['system', 'status', '--format', 'json'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return parseContainerSystemStatus(result.stdout);
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('A loopback smoke-test port could not be reserved.')));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function assertResourcesAbsent() {
  const containers = json(['list', '--all', '--format', 'json']);
  const volumes = json(['volume', 'list', '--format', 'json']);
  const images = json(['image', 'list', '--format', 'json']);
  if (
    containers.some((entry) => entry?.id === containerName) ||
    volumes.some((entry) => volumeNames.includes(entry?.configuration?.name)) ||
    images.some((entry) => entry?.configuration?.name === imageReference)
  ) {
    throw new Error('Exact smoke-test container resources are not absent.');
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await request({ path: '/api/health' });
      if (
        response.statusCode === 200 &&
        ['ok', 'degraded'].includes(response.body?.status) &&
        response.body?.fileCleanup?.pending === 0
      ) {
        return response;
      }
      lastError = new Error(`Health returned ${response.statusCode}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw lastError ?? new Error('Container health check timed out.');
}

function request({ method = 'GET', path: requestPath, host = `127.0.0.1:${port}`, body }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const outgoing = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method,
        headers: {
          Host: host,
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
        timeout: 5_000,
      },
      (incoming) => {
        const chunks = [];
        incoming.on('data', (chunk) => chunks.push(chunk));
        incoming.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ statusCode: incoming.statusCode, body: text ? JSON.parse(text) : null });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    outgoing.on('timeout', () => outgoing.destroy(new Error('HTTP request timed out.')));
    outgoing.on('error', reject);
    if (payload) outgoing.write(payload);
    outgoing.end();
  });
}

function cleanupAfterFailure() {
  if (!systemStarted) return undefined;
  const errors = [];
  try {
    if (containerCreated) run(['delete', '--force', containerName]);
  } catch (error) {
    errors.push(error);
  }
  for (const volume of volumesCreated) {
    try {
      run(['volume', 'delete', volume]);
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    if (imageCreated) run(['image', 'delete', '--force', imageReference]);
  } catch (error) {
    errors.push(error);
  }
  try {
    assertResourcesAbsent();
  } catch (error) {
    errors.push(error);
  }
  try {
    run(['system', 'stop']);
    if (systemStatus() === 'running') {
      throw new Error('Apple Container remained running after failure cleanup.');
    }
  } catch (error) {
    errors.push(error);
  }
  return errors.length > 0
    ? new AggregateError(errors, 'Exact container cleanup failed.')
    : undefined;
}
