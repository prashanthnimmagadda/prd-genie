import { spawnSync } from 'node:child_process';

const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
if (major !== 22 && major !== 24) {
  throw new Error('Node gate evidence must run on Node.js 22 or 24.');
}
const result = spawnSync(process.execPath, ['scripts/offline-ci.mjs', '--quick'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PRD_GENIE_OFFLINE_REPORT_NAME: `node-${major}.json`,
  },
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
