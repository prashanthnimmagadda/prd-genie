import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const hashFile = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceVisibility = process.env.PRD_GENIE_SOURCE_VISIBILITY ?? 'local-only';
const publicPromotionApproved = process.env.PRD_GENIE_PUBLIC_PROMOTION_APPROVED === 'true';
if (!['local-only', 'private-github', 'public-github'].includes(sourceVisibility)) {
  throw new Error(
    'PRD_GENIE_SOURCE_VISIBILITY must be local-only, private-github, or public-github.',
  );
}
if (sourceVisibility === 'public-github' && !publicPromotionApproved) {
  throw new Error('Public GitHub provenance requires explicit promotion approval.');
}
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
    sourceVisibility,
    employerEraInputsCopied: false,
    publicPromotionApproved,
  },
};

const reportDir = path.join(root, 'reports');
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'provenance.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Recorded provenance for ${artifacts.length} artifacts.`);
