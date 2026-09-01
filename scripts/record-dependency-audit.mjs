import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();

function audit(scope, args) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(npm, ['audit', '--json', '--audit-level=high', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    output = { parseError: true };
  }
  const vulnerabilities = output?.metadata?.vulnerabilities ?? {};
  const highOrCritical = (vulnerabilities.high ?? 0) + (vulnerabilities.critical ?? 0);
  return {
    scope,
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode: result.status ?? 1,
    passed: result.status === 0 && highOrCritical === 0 && output.parseError !== true,
    vulnerabilities,
    auditReportVersion: output.auditReportVersion ?? null,
    error: result.error?.message ?? (output.parseError ? result.stderr.trim() : null),
  };
}

const production = audit('production', ['--omit=dev']);
const full = audit('full', []);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  git: {
    sha: git(['rev-parse', 'HEAD']),
    clean: git(['status', '--porcelain=v1']).length === 0,
  },
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  online: true,
  passed: production.passed && full.passed,
  results: [production, full],
};
const reportDirectory = path.join(root, 'reports');
fs.mkdirSync(reportDirectory, { recursive: true });
fs.writeFileSync(
  path.join(reportDirectory, 'dependency-audit.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  report.passed
    ? 'Online production and full dependency audits found no high or critical vulnerabilities.'
    : 'Online dependency audit evidence failed.',
);
process.exitCode = report.passed ? 0 : 1;
