import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const quick = process.argv.includes('--quick');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const steps = [
  ['content', ['run', 'content:check']],
  ['format', ['run', 'format:check']],
  ['lint', ['run', 'lint']],
  ['types', ['run', 'typecheck']],
  ['coverage', ['run', 'test:coverage']],
  ['build', ['run', 'build']],
  ['dependency-audit', ['audit', '--audit-level=low']],
  ['licenses', ['run', 'licenses']],
  ['sbom', ['run', 'sbom']],
  ...(!quick ? [['browser', ['run', 'test:e2e']]] : []),
];

const startedAt = new Date();
const results = [];
for (const [name, args] of steps) {
  const stepStartedAt = new Date();
  const result = spawnSync(npm, args, {
    cwd: root,
    env: { ...process.env, CI: '1' },
    stdio: 'inherit',
  });
  const exitCode = result.status ?? 1;
  results.push({
    name,
    command: `npm ${args.join(' ')}`,
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
