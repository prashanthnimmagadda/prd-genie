import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const quick = process.argv.includes('--quick');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const hostPolicyCheck = `
  import { resolveServerHost } from './src/server/config.ts';
  const permittedNativeHosts = ['127.0.0.1', '::1'];
  for (const host of permittedNativeHosts) {
    if (resolveServerHost(host, false) !== host) throw new Error(\`Expected \${host} to be accepted.\`);
  }
  for (const host of ['0.0.0.0', '192.168.1.10', 'localhost']) {
    let rejected = false;
    try { resolveServerHost(host, false); } catch { rejected = true; }
    if (!rejected) throw new Error(\`Expected \${host} to be rejected for a native run.\`);
  }
  if (resolveServerHost('0.0.0.0', true) !== '0.0.0.0') {
    throw new Error('Expected the container marker to permit 0.0.0.0.');
  }
`;

if (process.env.GITHUB_ACTIONS === 'true') {
  console.error('Offline CI must run outside GitHub Actions.');
  process.exit(1);
}
const steps = [
  [
    'host-policy',
    [
      process.execPath,
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      hostPolicyCheck,
    ],
  ],
  ['content', ['run', 'content:check']],
  ['format', ['run', 'format:check']],
  ['lint', ['run', 'lint']],
  ['types', ['run', 'typecheck']],
  ['coverage', ['run', 'test:coverage']],
  ['build', ['run', 'build']],
  ['dependency-audit', ['audit', '--offline', '--audit-level=low']],
  ['licenses', ['run', 'licenses']],
  ['sbom', ['run', 'sbom']],
  ...(!quick ? [['browser', ['run', 'test:e2e']]] : []),
];

const startedAt = new Date();
const results = [];
for (const [name, args] of steps) {
  const stepStartedAt = new Date();
  const [command, ...commandArgs] = name === 'host-policy' ? args : [npm, ...args];
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, CI: '1' },
    stdio: 'inherit',
  });
  const exitCode = result.status ?? 1;
  results.push({
    name,
    command: [command, ...commandArgs].join(' '),
    startedAt: stepStartedAt.toISOString(),
    durationMs: Date.now() - stepStartedAt.getTime(),
    exitCode,
    status: exitCode === 0 ? 'passed' : 'failed',
  });
  if (exitCode !== 0) break;
}

const passed = results.length === steps.length && results.every((result) => result.exitCode === 0);
const report = {
  schemaVersion: 1,
  mode: quick ? 'quick' : 'full',
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  passed,
  results,
};
const reportDirectory = path.join(root, 'reports');
fs.mkdirSync(reportDirectory, { recursive: true });
fs.writeFileSync(
  path.join(reportDirectory, 'offline-ci.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  passed
    ? `Offline ${report.mode} gate passed ${results.length}/${steps.length} steps.`
    : `Offline ${report.mode} gate failed at ${results.at(-1)?.name ?? 'startup'}.`,
);
process.exitCode = passed ? 0 : 1;
