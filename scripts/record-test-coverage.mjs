import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const reportsDirectory = path.join(root, 'reports');
const rawPath = path.join(reportsDirectory, '.test-coverage.raw.json');
const reportPath = path.join(reportsDirectory, 'test-coverage.json');
const coveragePath = path.join(root, 'coverage/coverage-summary.json');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
fs.mkdirSync(reportsDirectory, { recursive: true });
fs.rmSync(rawPath, { force: true });

const startedAt = new Date().toISOString();
const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs');
const child = spawnSync(
  process.execPath,
  [vitestCli, 'run', '--coverage', '--reporter=json', `--outputFile=${rawPath}`],
  { cwd: root, env: process.env, stdio: 'inherit' },
);
if (child.error) throw child.error;

let raw;
try {
  raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
} finally {
  fs.rmSync(rawPath, { force: true });
}
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
const exitCode = child.status ?? 1;
const passed =
  exitCode === 0 &&
  raw?.success === true &&
  Number.isInteger(raw?.numTotalTests) &&
  raw.numTotalTests > 0 &&
  raw.numPassedTests === raw.numTotalTests &&
  raw.numFailedTests === 0 &&
  raw.numPendingTests === 0 &&
  raw.numTodoTests === 0 &&
  Array.isArray(raw.testResults) &&
  raw.testResults.length > 0;
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
  command: 'vitest run --coverage --reporter=json',
  exitCode,
  passed,
  suites: {
    files: raw.testResults.length,
    total: raw.numTotalTestSuites,
    passed: raw.numPassedTestSuites,
    failed: raw.numFailedTestSuites,
    pending: raw.numPendingTestSuites,
  },
  tests: {
    total: raw.numTotalTests,
    passed: raw.numPassedTests,
    failed: raw.numFailedTests,
    pending: raw.numPendingTests,
    todo: raw.numTodoTests,
  },
  coverage: coverage.total,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Recorded ${report.tests.passed}/${report.tests.total} passing tests across ${report.suites.files} files.`,
);
if (!passed) process.exitCode = exitCode || 1;
