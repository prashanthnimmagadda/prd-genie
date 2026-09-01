import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  collectArtifactPaths,
  publicProductName,
  publicReleaseTarget,
  validateEvidenceReports,
  validatePublicApproval,
} from './provenance-policy.mjs';

const root = path.resolve(import.meta.dirname, '..');
const hashFile = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceVisibility = process.env.PRD_GENIE_SOURCE_VISIBILITY ?? 'local-only';
if (!['local-only', 'private-github', 'public-github'].includes(sourceVisibility)) {
  throw new Error(
    'PRD_GENIE_SOURCE_VISIBILITY must be local-only, private-github, or public-github.',
  );
}

const gitSha = git(['rev-parse', 'HEAD']);
const clean = git(['status', '--porcelain=v1']).length === 0;
const artifacts = collectArtifactPaths(root).map((relative) => ({
  path: relative,
  sha256: hashFile(path.join(root, relative)),
}));
validateEvidenceReports(root, gitSha);

let releaseTag = null;
let publicPromotionApproved = false;
let publicApproval = null;
if (sourceVisibility === 'public-github') {
  const approvalPath = process.env.PRD_GENIE_PUBLIC_APPROVAL_FILE;
  if (!approvalPath) throw new Error('Public GitHub provenance requires an approval file.');
  const approval = JSON.parse(fs.readFileSync(path.resolve(approvalPath), 'utf8'));
  const tag = typeof approval?.tag === 'string' ? approval.tag : '';
  const tagSha = (() => {
    try {
      return git(['rev-list', '-n', '1', tag]);
    } catch {
      throw new Error('The approved release tag does not exist.');
    }
  })();
  validatePublicApproval({ approval, artifacts, gitSha, clean, tagSha });
  releaseTag = tag;
  publicPromotionApproved = true;
  publicApproval = approval;
}

const report = {
  generatedAt: new Date().toISOString(),
  git: {
    sha: gitSha,
    branch: git(['branch', '--show-current']),
    clean,
  },
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  artifacts,
  claims: {
    sourceVisibility,
    knownProtectedInputsDetected: false,
    publicationRightsAttestationRequired: true,
    publicPromotionApproved,
    releaseTag,
    publicTarget: publicPromotionApproved ? publicReleaseTarget : null,
    publicName: publicPromotionApproved ? publicProductName : null,
    rightsConfirmed: publicApproval?.rightsConfirmed === true,
    validationStatus: publicApproval?.validationStatus ?? null,
    knownLimitations: publicApproval?.knownLimitations ?? [],
    unresolvedIssues: publicApproval?.unresolvedIssues ?? [],
  },
};

const reportDir = path.join(root, 'reports');
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'provenance.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Recorded provenance for ${artifacts.length} artifacts.`);
