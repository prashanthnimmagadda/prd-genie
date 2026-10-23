import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

if (process.platform !== 'darwin') throw new Error('macOS packaging must run on macOS.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'dist/mac/PRD Genie.app');
const contents = path.join(app, 'Contents');
const resources = path.join(contents, 'Resources');
const appRoot = path.join(resources, 'app');
const binary = path.join(contents, 'MacOS', 'PRD Genie');
if (
  !existsSync(path.join(root, 'dist/client/index.html')) ||
  !existsSync(path.join(root, 'dist/server/server/index.js'))
) {
  throw new Error('Run npm run build before npm run package:mac.');
}
rmSync(app, { recursive: true, force: true });
mkdirSync(path.dirname(binary), { recursive: true });
mkdirSync(path.join(appRoot, 'node_modules'), { recursive: true });
cpSync(path.join(root, 'dist/client'), path.join(appRoot, 'dist/client'), { recursive: true });
cpSync(path.join(root, 'dist/server'), path.join(appRoot, 'dist/server'), { recursive: true });
cpSync(path.join(root, 'drizzle'), path.join(appRoot, 'drizzle'), { recursive: true });
cpSync(path.join(root, 'package.json'), path.join(appRoot, 'package.json'));
cpSync(path.join(root, 'src/client/SHADCN-LICENSE.md'), path.join(resources, 'SHADCN-LICENSE.md'));
cpSync(realpathSync(process.execPath), path.join(resources, 'node'));

const installed = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
})
  .trim()
  .split('\n')
  .slice(1);
for (const source of installed) {
  const relative = path.relative(path.join(root, 'node_modules'), source);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`Unexpected dependency location: ${source}`);
  const target = path.join(appRoot, 'node_modules', relative);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, dereference: true });
}

const swiftEnv = {
  ...process.env,
  CLANG_MODULE_CACHE_PATH: path.join(tmpdir(), 'prd-genie-clang-cache'),
  SWIFT_MODULECACHE_PATH: path.join(tmpdir(), 'prd-genie-swift-cache'),
};
execFileSync(
  'swiftc',
  [
    '-target',
    `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`,
    path.join(root, 'scripts/mac/PRDGenie.swift'),
    '-o',
    binary,
    '-framework',
    'Cocoa',
    '-framework',
    'WebKit',
  ],
  { cwd: root, stdio: 'inherit', env: swiftEnv },
);
const ocrSource = path.join(root, 'scripts/mac/JpegOCR.swift');
if (existsSync(ocrSource)) {
  execFileSync(
    'swiftc',
    [
      '-O',
      '-target',
      `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`,
      ocrSource,
      '-o',
      path.join(resources, 'jpeg-ocr'),
      '-framework',
      'Vision',
      '-framework',
      'AppKit',
    ],
    { cwd: root, stdio: 'inherit', env: swiftEnv },
  );
}

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
writeFileSync(
  path.join(contents, 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.stillform.prdgenie</string>
<key>CFBundleName</key><string>PRD Genie</string>
<key>CFBundleDisplayName</key><string>PRD Genie</string>
<key>CFBundleVersion</key><string>${packageJson.version}</string>
<key>CFBundleShortVersionString</key><string>${packageJson.version}</string>
<key>CFBundleExecutable</key><string>PRD Genie</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>`,
);
console.log(`Created ${app}`);
console.log(
  'This is an unsigned local build; signing, notarization, and public distribution are separate steps.',
);
