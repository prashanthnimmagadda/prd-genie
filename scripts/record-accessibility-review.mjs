import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const inputPath = process.env.PRD_GENIE_ACCESSIBILITY_REVIEW_FILE;
if (!inputPath) {
  throw new Error('PRD_GENIE_ACCESSIBILITY_REVIEW_FILE must name the completed review input.');
}
const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
const gitSha = git(['rev-parse', 'HEAD']);
const clean = git(['status', '--porcelain=v1']).length === 0;
const requiredChecks = [
  'keyboardNavigation',
  'visibleFocus',
  'semanticControls',
  'labelsAndDialogs',
  'screenReaderAnnouncements',
  'reducedMotion',
  'errorAndEmptyStates',
  'longContent',
  'contrastWcag22Aa',
  'localFontsAndAssets',
];
if (
  input.schemaVersion !== 1 ||
  input.gitSha !== gitSha ||
  clean !== true ||
  input.reviewMethod !== 'manual-browser-and-source-review' ||
  !Array.isArray(input.widths) ||
  JSON.stringify([...input.widths].sort((left, right) => left - right)) !==
    JSON.stringify([320, 375, 414, 768, 1440]) ||
  requiredChecks.some((check) => input.checks?.[check] !== true) ||
  !Array.isArray(input.materialWarnings) ||
  input.materialWarnings.length !== 0 ||
  !Array.isArray(input.limitations)
) {
  throw new Error('The manual accessibility review input is incomplete or does not match HEAD.');
}
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  git: { sha: gitSha, clean },
  reviewer: input.reviewer,
  reviewMethod: input.reviewMethod,
  widths: input.widths,
  checks: input.checks,
  materialWarnings: input.materialWarnings,
  limitations: input.limitations,
  passed: true,
};
const reportDirectory = path.join(root, 'reports');
fs.mkdirSync(reportDirectory, { recursive: true });
fs.writeFileSync(
  path.join(reportDirectory, 'accessibility-review.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log('Recorded the exact-SHA manual accessibility review.');
