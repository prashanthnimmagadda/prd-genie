import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { collectFinalReleaseAssets, validateFinalPromotionApproval } from './provenance-policy.mjs';

const [releaseDirectoryArgument, approvalFileArgument] = process.argv.slice(2);
if (!releaseDirectoryArgument || !approvalFileArgument) {
  throw new Error('Expected the final release directory and final promotion approval file.');
}

const root = path.resolve(import.meta.dirname, '..');
const releaseDirectory = path.resolve(releaseDirectoryArgument);
const approvalFile = path.resolve(approvalFileArgument);
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const approval = JSON.parse(fs.readFileSync(approvalFile, 'utf8'));
const gitSha = git(['rev-parse', 'HEAD']);
const clean = git(['status', '--porcelain=v1']).length === 0;
const tag = typeof approval?.tag === 'string' ? approval.tag : '';
const tagSha = (() => {
  try {
    return git(['rev-list', '-n', '1', tag]);
  } catch {
    throw new Error('The approved release tag does not exist.');
  }
})();
const tagObjectSha = (() => {
  try {
    return git(['rev-parse', `${tag}^{tag}`]);
  } catch {
    throw new Error('The approved release tag is not annotated.');
  }
})();

const releaseAssets = collectFinalReleaseAssets({ releaseDirectory, gitSha, tag });
validateFinalPromotionApproval({
  approval,
  releaseAssets,
  gitSha,
  clean,
  tagSha,
  tagObjectSha,
});

console.log(
  JSON.stringify(
    {
      approved: true,
      gitSha,
      tag,
      tagObjectSha,
      releaseAssets,
    },
    null,
    2,
  ),
);
