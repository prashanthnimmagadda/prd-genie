// Signs, notarises and staples dist/mac/PRD Genie.app, then builds the final ZIP
// from the stapled app. It never creates or reads credential values: the Developer
// ID identity must already be in the keychain and the notary profile must already be
// stored with `xcrun notarytool store-credentials`.
//
//   PRD_GENIE_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)" \
//   PRD_GENIE_NOTARY_PROFILE=prd-genie-notary node scripts/sign-macos.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const identity = process.env.PRD_GENIE_SIGNING_IDENTITY;
const profile = process.env.PRD_GENIE_NOTARY_PROFILE;
if (!identity?.startsWith('Developer ID Application: ') || !profile) {
  throw new Error(
    'Set PRD_GENIE_SIGNING_IDENTITY (Developer ID Application) and PRD_GENIE_NOTARY_PROFILE.',
  );
}
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const app = path.join(root, 'dist/mac/PRD Genie.app');
const zip = path.join(root, `dist/mac/prd-genie-v${version}-macos-arm64.zip`);
const submission = path.join(root, `dist/mac/notary-submission-v${version}.zip`);
const entitlements = path.join(root, 'scripts/mac/node.entitlements');
const reports = path.join(root, 'reports');
if (!existsSync(app)) throw new Error('Package the app first with npm run package:mac.');

const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const log = [];
const record = (command, args) => {
  const output = execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  log.push(
    `$ ${command} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`,
    output.trim(),
  );
  return output;
};

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    const info = statSync(full);
    return info.isDirectory() ? walk(full) : [full];
  });
}
const isMachO = (file) => run('file', ['-b', file]).startsWith('Mach-O');
const files = walk(app);
const native = files.filter(isMachO);
const executables = new Set([
  path.join(app, 'Contents/Resources/node'),
  path.join(app, 'Contents/Resources/jpeg-ocr'),
  path.join(app, 'Contents/MacOS/PRD Genie'),
]);

// Inside-out: libraries and add-ons first, then helper executables, then the app.
const sign = (target, extra = []) =>
  record('codesign', [
    '--force',
    '--sign',
    identity,
    '--options',
    'runtime',
    '--timestamp',
    ...extra,
    target,
  ]);
for (const file of native.filter((file) => !executables.has(file))) sign(file);
sign(path.join(app, 'Contents/Resources/node'), ['--entitlements', entitlements]);
sign(path.join(app, 'Contents/Resources/jpeg-ocr'));
sign(app);
record('codesign', ['--verify', '--strict', '--verbose=2', app]);
for (const file of native) record('codesign', ['--verify', '--strict', file]);

rmSync(submission, { force: true });
record('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, submission]);
const submitted = record('xcrun', [
  'notarytool',
  'submit',
  submission,
  '--keychain-profile',
  profile,
  '--wait',
  '--output-format',
  'json',
]);
const result = JSON.parse(submitted);
if (result.status !== 'Accepted')
  throw new Error(`Notarisation status: ${result.status} (${result.id})`);
const notaryLog = record('xcrun', ['notarytool', 'log', result.id, '--keychain-profile', profile]);
writeFileSync(path.join(reports, 'macos-notarization.json'), notaryLog);

record('xcrun', ['stapler', 'staple', app]);
record('xcrun', ['stapler', 'validate', app]);
record('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
rmSync(zip, { force: true });
record('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
rmSync(submission, { force: true });

const sha = createHash('sha256').update(readFileSync(zip)).digest('hex');
log.push(`final archive ${path.basename(zip)} sha256 ${sha}`);
writeFileSync(path.join(reports, 'macos-verification.txt'), `${log.join('\n')}\n`);
console.log(
  `Notarised ${result.id}; stapled; Gatekeeper accepted. ${path.basename(zip)} sha256 ${sha}`,
);
