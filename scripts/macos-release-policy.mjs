import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const macosReportPath = 'reports/macos-release.json';
export const macosBundlePath = 'dist/mac/PRD Genie.app';
export const macosChecks = [
  'developerIdApplication',
  'nestedSignatures',
  'hardenedRuntime',
  'secureTimestamps',
  'strictSignatureVerification',
  'notarizationAccepted',
  'stapleValidated',
  'gatekeeperAccepted',
  'finalArchiveMatchesBundle',
  'installedFromFinalArchive',
  'launchSucceeded',
  'offlineEditSaveReopenExport',
  'noSecurityBypass',
];

export function macosZipName(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
    throw new Error('macOS release requires an exact package version.');
  }
  return `prd-genie-v${version}-macos-arm64.zip`;
}

const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function inspectMacosArchive(archive, components, inspect) {
  // List before extracting: permit only this app and ditto's AppleDouble metadata.
  // Reject links and special files, including entries that could escape the temp directory.
  const list = (verbose) =>
    execFileSync('/usr/bin/zipinfo', [verbose ? '-l' : '-1', archive], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
      .trimEnd()
      .split('\n');
  const names = list(false);
  const modes = list(true).slice(2, -1);
  if (
    new Set(names).size !== names.length ||
    names.some(
      (name) =>
        (!/^(?:PRD Genie\.app|__MACOSX\/(?:\._)?PRD Genie\.app)(?:\/|$)/.test(name) &&
          name !== '__MACOSX/') ||
        name.includes('\\') ||
        name.split('/').some((part) => part === '..' || part === '.') ||
        [...name].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
    ) ||
    modes.length !== names.length ||
    modes.some(
      (line, index) => !/^[-d][rwxstST?-]{6,9}\s/.test(line) || !line.endsWith(` ${names[index]}`),
    )
  ) {
    throw new Error('macOS ZIP contains an unsafe or unexpected entry.');
  }
  const appFiles = names
    .filter((name, index) => modes[index].startsWith('-') && !name.startsWith('__MACOSX/'))
    .sort();
  const expectedFiles = components
    .map((component) => component.path.slice('dist/mac/'.length))
    .sort();
  if (JSON.stringify(appFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('macOS ZIP entry inventory differs from the signed bundle.');
  }
  // ditto consumes AppleDouble sidecars during extraction. Validate them first;
  // arbitrary payloads in the metadata tree must not disappear from inspection.
  for (const name of names.filter(
    (entry) => entry.startsWith('__MACOSX/') && !entry.endsWith('/'),
  )) {
    const basename = path.posix.basename(name);
    const target = path.posix.join(
      path.posix.dirname(name.slice('__MACOSX/'.length)),
      basename.slice(2),
    );
    if (
      ['?', '*', '[', ']'].some((character) => name.includes(character)) ||
      !basename.startsWith('._') ||
      !names.some((entry) => entry.replace(/\/$/, '') === target)
    ) {
      throw new Error('macOS ZIP contains unrelated metadata.');
    }
    const data = execFileSync('/usr/bin/unzip', ['-p', archive, name], {
      maxBuffer: 16 * 1024 * 1024,
    });
    if (
      data.length < 26 ||
      data.readUInt32BE(0) !== 0x00051607 ||
      data.readUInt32BE(4) !== 0x00020000
    ) {
      throw new Error('macOS ZIP metadata is not AppleDouble.');
    }
    const count = data.readUInt16BE(24);
    const end = 26 + count * 12;
    if (!count || end > data.length) throw new Error('macOS ZIP metadata is truncated.');
    for (let index = 26; index < end; index += 12) {
      const offset = data.readUInt32BE(index + 4);
      const size = data.readUInt32BE(index + 8);
      if (offset < end || offset + size > data.length)
        throw new Error('macOS ZIP metadata is truncated.');
    }
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-signed-archive-'));
  try {
    execFileSync('/usr/bin/ditto', ['-x', '-k', archive, temporary], { stdio: 'pipe' });
    const extracted = [];
    const visit = (relative) => {
      const absolute = path.join(temporary, relative);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('macOS archive contains a symbolic link.');
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(absolute).sort()) visit(`${relative}/${name}`);
      } else if (stat.isFile())
        extracted.push({ path: `dist/mac/${relative}`, sha256: hash(absolute) });
      else throw new Error('macOS archive contains a special file.');
    };
    visit('PRD Genie.app');
    extracted.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    if (JSON.stringify(extracted) !== JSON.stringify(components)) {
      throw new Error('macOS ZIP contents differ from the complete signed bundle inventory.');
    }
    inspect(path.join(temporary, 'PRD Genie.app'));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function collectMacosArtifactPaths(root) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  // An ordinary unsigned development .app does not opt into public distribution.
  if (!fs.existsSync(path.join(root, macosReportPath))) {
    if (version && fs.existsSync(path.join(root, 'dist/mac', macosZipName(version)))) {
      throw new Error('macOS ZIP requires its release evidence report.');
    }
    return [];
  }
  const files = [
    macosReportPath,
    'reports/macos-notarization.json',
    'reports/macos-verification.txt',
    `dist/mac/${macosZipName(version)}`,
  ];
  const visit = (relative) => {
    const stat = fs.lstatSync(path.join(root, relative));
    if (stat.isSymbolicLink()) throw new Error('macOS evidence cannot contain symbolic links.');
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(path.join(root, relative)).sort()) {
        visit(`${relative}/${entry}`);
      }
    } else if (stat.isFile()) files.push(relative);
    else throw new Error('macOS evidence must contain regular files.');
  };
  visit(macosBundlePath);
  for (const file of files) {
    if (!fs.lstatSync(path.join(root, file)).isFile()) {
      throw new Error('macOS evidence must contain regular files.');
    }
  }
  return files.sort();
}

// Bind the packaged first-party runtime to the same outputs covered by release evidence.
export function validateMacosApplicationInputs(root) {
  const packaged = path.join(root, macosBundlePath, 'Contents/Resources/app');
  const inventory = (base, relative) => {
    const records = [];
    const visit = (entry) => {
      const absolute = path.join(base, entry);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink())
        throw new Error('Application inputs cannot contain symbolic links.');
      if (stat.isDirectory())
        for (const name of fs.readdirSync(absolute).sort()) visit(`${entry}/${name}`);
      else if (stat.isFile()) records.push({ path: entry, sha256: hash(absolute) });
      else throw new Error('Application inputs must be regular files.');
    };
    visit(relative);
    return records;
  };
  for (const relative of ['dist/client', 'dist/server', 'drizzle', 'package.json']) {
    if (
      JSON.stringify(inventory(root, relative)) !== JSON.stringify(inventory(packaged, relative))
    ) {
      throw new Error(`Packaged application input differs from validated build: ${relative}`);
    }
  }
}

export function validateMacosReleaseReport(report, expected) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (
    report?.schemaVersion !== 1 ||
    report.git?.sha !== expected.gitSha ||
    report.git?.clean !== true ||
    report.passed !== true ||
    report.architecture !== 'arm64' ||
    report.version !== expected.version ||
    report.build !== expected.build ||
    report.bundleIdentifier !== 'app.stillform.prdgenie' ||
    !same(report.archive, expected.archive) ||
    !Array.isArray(report.components) ||
    !same(report.components, expected.components) ||
    !Array.isArray(report.nativeCode) ||
    !same(report.nativeCode, expected.nativeCode) ||
    !/^[A-Z0-9]{10}$/.test(report.teamIdentifier ?? '') ||
    report.signingAuthority !==
      `Developer ID Application: ${report.signingName} (${report.teamIdentifier})` ||
    typeof report.signingName !== 'string' ||
    !report.signingName.trim() ||
    report.notarization?.id !== expected.notarization.jobId ||
    expected.notarization.status !== 'Accepted' ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(expected.notarization.jobId ?? '') ||
    !/^[a-f0-9]{64}$/.test(expected.notarization.sha256 ?? '') ||
    report.notarization?.logSha256 !== expected.notarizationLogSha256 ||
    report.verificationLogSha256 !== expected.verificationLogSha256 ||
    report.installation?.archiveSha256 !== expected.archive.sha256 ||
    report.installation?.architecture !== 'arm64' ||
    report.installation?.version !== expected.version ||
    report.installation?.build !== expected.build ||
    typeof report.installation?.macOSVersion !== 'string' ||
    !/^\d+\.\d+(?:\.\d+)?$/.test(report.installation.macOSVersion) ||
    !Number.isFinite(Date.parse(report.installation?.verifiedAt ?? '')) ||
    typeof report.installation?.reviewer !== 'string' ||
    !report.installation.reviewer.trim() ||
    !same(Object.keys(report.checks ?? {}).sort(), [...macosChecks].sort()) ||
    macosChecks.some((check) => report.checks[check] !== true)
  ) {
    throw new Error('macOS release evidence does not bind the verified final ARM64 package.');
  }
}

// Verification only: never signs, submits, staples, launches, or accesses credentials.
export function validateMacosReleaseEvidence(root, gitSha, archiveOverride) {
  const files = collectMacosArtifactPaths(root);
  if (files.length === 0) {
    if (archiveOverride) throw new Error('macOS ZIP requires its release evidence report.');
    return;
  }
  const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  const report = read(macosReportPath);
  if (fs.statSync(path.join(root, 'reports/macos-verification.txt')).size === 0) {
    throw new Error('macOS verification transcript is empty.');
  }
  const notarization = read('reports/macos-notarization.json');
  const { version } = read('package.json');
  const archivePath = `dist/mac/${macosZipName(version)}`;
  const archive = {
    path: archivePath,
    sha256: hash(path.join(root, archivePath)),
  };
  if (archiveOverride && hash(archiveOverride) !== archive.sha256) {
    throw new Error('Final macOS ZIP differs from the verified preparation artifact.');
  }
  const components = files
    .filter((file) => file.startsWith(`${macosBundlePath}/`))
    .map((file) => ({ path: file, sha256: hash(path.join(root, file)) }));
  const nativeCode = components.filter(({ path: file }) => {
    const fd = fs.openSync(path.join(root, file), 'r');
    const header = Buffer.alloc(8);
    try {
      fs.readSync(fd, header, 0, 8, 0);
    } finally {
      fs.closeSync(fd);
    }
    const magic = header.readUInt32LE(0);
    if (
      ![
        0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xbebafeca, 0xcafebabe, 0xbfbafeca,
        0xcafebabf,
      ].includes(magic)
    )
      return false;
    if (magic !== 0xfeedfacf || header.readUInt32LE(4) !== 0x0100000c) {
      throw new Error('Every bundled native component must be ARM64 only.');
    }
    return true;
  });
  for (const required of [
    'Contents/MacOS/PRD Genie',
    'Contents/Resources/node',
    'Contents/Resources/jpeg-ocr',
  ]) {
    if (!nativeCode.some((item) => item.path === `${macosBundlePath}/${required}`)) {
      throw new Error(`Required macOS native component is missing: ${required}`);
    }
  }
  validateMacosApplicationInputs(root);
  const app = path.join(root, macosBundlePath);
  const plist = (key) =>
    execFileSync(
      '/usr/bin/plutil',
      ['-extract', key, 'raw', path.join(app, 'Contents/Info.plist')],
      { encoding: 'utf8' },
    ).trim();
  const build = execFileSync('git', ['rev-list', '--count', gitSha], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (
    plist('PRDGenieGitCommit') !== gitSha ||
    plist('PRDGenieReleaseVersion') !== version ||
    plist('CFBundleShortVersionString') !== version.split('-')[0] ||
    plist('CFBundleVersion') !== build ||
    plist('CFBundleIdentifier') !== 'app.stillform.prdgenie'
  ) {
    throw new Error('macOS bundle identity does not match the exact release commit and version.');
  }
  validateMacosReleaseReport(report, {
    gitSha,
    version,
    build,
    archive,
    components,
    nativeCode,
    notarization,
    notarizationLogSha256: hash(path.join(root, 'reports/macos-notarization.json')),
    verificationLogSha256: hash(path.join(root, 'reports/macos-verification.txt')),
  });
  inspectMacosArchive(
    archiveOverride ?? path.join(root, archivePath),
    components,
    (extractedApp) => {
      const requirement = `anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${report.teamIdentifier}"`;
      for (const target of [
        extractedApp,
        ...nativeCode.map((item) =>
          path.join(extractedApp, item.path.slice(macosBundlePath.length + 1)),
        ),
      ]) {
        execFileSync('/usr/bin/codesign', ['--verify', '--strict', '-R', requirement, target], {
          stdio: 'pipe',
        });
        // codesign writes its display output to stderr.
        const result = execFileSync(
          '/bin/sh',
          ['-c', 'exec /usr/bin/codesign -d --verbose=4 "$1" 2>&1', 'codesign-display', target],
          { encoding: 'utf8' },
        );
        if (
          !result.includes(`Authority=${report.signingAuthority}\n`) ||
          !result.includes(`TeamIdentifier=${report.teamIdentifier}\n`) ||
          !/flags=.*\bruntime\b/.test(result) ||
          !/^Timestamp=.+/m.test(result)
        ) {
          throw new Error(
            'macOS component requires Developer ID, hardened runtime and secure timestamp.',
          );
        }
        const cdhash = /^CDHash=([a-f0-9]+)$/m.exec(result)?.[1];
        if (
          !cdhash ||
          !notarization.ticketContents?.some(
            (ticket) => ticket.arch === 'arm64' && ticket.cdhash === cdhash,
          )
        ) {
          throw new Error('Native signature is absent from the accepted notarization tickets.');
        }
      }
      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', extractedApp], {
        stdio: 'pipe',
      });
      execFileSync('/usr/bin/xcrun', ['stapler', 'validate', extractedApp], { stdio: 'pipe' });
      execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', extractedApp], {
        stdio: 'pipe',
      });
    },
  );
}
