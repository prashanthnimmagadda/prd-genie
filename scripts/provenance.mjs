import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const hashFile = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const artifacts = [
  'package-lock.json',
  'reports/licenses.json',
  'reports/sbom.cdx.json',
  'dist/client/index.html',
  'dist/server/server/index.js',
]
  .filter((relative) => fs.existsSync(path.join(root, relative)))
  .map((relative) => ({ path: relative, sha256: hashFile(path.join(root, relative)) }));

const report = {
  generatedAt: new Date().toISOString(),
  git: {
    sha: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
    clean: git(['status', '--porcelain=v1']).length === 0,
  },
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  artifacts,
  claims: {
    sourceVisibility: 'local-only',
    employerEraInputsCopied: false,
    publicPromotionApproved: false,
  },
};

const reportDir = path.join(root, 'reports');
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'provenance.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Recorded provenance for ${artifacts.length} artifacts.`);
