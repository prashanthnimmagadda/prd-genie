import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const reportDirectory = path.join(root, 'reports');
const rawPath = path.join(reportDirectory, '.browser-e2e.raw.json');
const outputPath = path.join(reportDirectory, 'browser-e2e.json');
fs.mkdirSync(reportDirectory, { recursive: true });
fs.rmSync(rawPath, { force: true });

const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], {
  cwd: root,
  env: {
    ...process.env,
    CI: '1',
    PRD_GENIE_BROWSER_EVIDENCE_RAW: rawPath,
  },
  stdio: 'inherit',
});
const exitCode = result.status ?? 1;
const playwright = fs.existsSync(rawPath)
  ? JSON.parse(fs.readFileSync(rawPath, 'utf8'))
  : { error: 'Playwright did not produce its JSON report.' };
fs.rmSync(rawPath, { force: true });

const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
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
  command: 'playwright test',
  passed: exitCode === 0,
  exitCode,
  playwright,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Browser evidence recorded at ${path.relative(root, outputPath)}.`);
process.exitCode = exitCode;
