import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});
import {
  collectArtifactPaths,
  collectFinalReleaseAssets,
  containsInventedExample,
  containsUnsupportedQualifier,
  parseContainerSystemStatus,
  publicProductName,
  publicReleaseTarget,
  requiredAccessibilityChecks,
  requiredAccessibilityWidths,
  requiredAdversarialStructuredReviewChecks,
  requiredArtifactDirectories,
  requiredArtifactFiles,
  requiredBrowserProjects,
  requiredModelScenarioChecks,
  requiredOfflineSteps,
  requiredPersistenceChecks,
  requiredProductionSmokeChecks,
  requiredStructuredReviewChecks,
  validateContainerSmokeReport,
  validateEvidenceReports,
  validateFinalPromotionApproval,
  validatePublicProvenanceAuthorization,
} from '../../scripts/provenance-policy.mjs';

import {
  collectMacosArtifactPaths,
  macosBundlePath,
  macosChecks,
  macosZipName,
  validateMacosApplicationInputs,
  validateMacosReleaseReport,
  validateMacosReleaseEvidence,
  inspectMacosArchive,
} from '../../scripts/macos-release-policy.mjs';

const gitSha = 'a'.repeat(40);

describe('release provenance policy', () => {
  const directories: string[] = [];
  afterEach(() => {
    vi.mocked(execFileSync).mockReset();
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('binds macOS attestation to the final package, identity and observed installation', () => {
    const archive = { path: `dist/mac/${macosZipName('0.1.0-rc.3')}`, sha256: 'b'.repeat(64) };
    const components = [
      { path: `${macosBundlePath}/Contents/MacOS/PRD Genie`, sha256: 'c'.repeat(64) },
    ];
    const notarization = {
      jobId: '12345678-1234-1234-1234-123456789abc',
      status: 'Accepted',
      sha256: 'd'.repeat(64),
    };
    const expected = {
      gitSha,
      version: '0.1.0-rc.3',
      build: '112',
      archive,
      components,
      nativeCode: components,
      notarization,
      notarizationLogSha256: 'e'.repeat(64),
      verificationLogSha256: 'f'.repeat(64),
    };
    // Policy fixture only; this is not a signed-package or installation result.
    const report = {
      schemaVersion: 1,
      git: { sha: gitSha, clean: true },
      passed: true,
      architecture: 'arm64',
      version: expected.version,
      build: expected.build,
      bundleIdentifier: 'app.stillform.prdgenie',
      archive,
      components,
      nativeCode: components,
      teamIdentifier: 'ABCDE12345',
      signingName: 'Policy Fixture',
      signingAuthority: 'Developer ID Application: Policy Fixture (ABCDE12345)',
      notarization: { id: notarization.jobId, logSha256: expected.notarizationLogSha256 },
      verificationLogSha256: expected.verificationLogSha256,
      installation: {
        archiveSha256: archive.sha256,
        architecture: 'arm64',
        version: expected.version,
        build: expected.build,
        macOSVersion: '26.0',
        verifiedAt: '2026-10-23T12:00:00Z',
        reviewer: 'Policy fixture',
      },
      checks: trueChecks(macosChecks),
    };
    expect(() => validateMacosReleaseReport(report, expected)).not.toThrow();
    const mutations: Array<(value: typeof report) => void> = [
      (value) => {
        value.git.sha = '0'.repeat(40);
      },
      (value) => {
        value.git.clean = false;
      },
      (value) => {
        value.architecture = 'x64';
      },
      (value) => {
        value.version = '0.1.0';
      },
      (value) => {
        value.build = '111';
      },
      (value) => {
        value.archive.sha256 = '0'.repeat(64);
      },
      (value) => {
        value.components = [];
      },
      (value) => {
        value.nativeCode = [];
      },
      (value) => {
        value.signingAuthority = 'adhoc';
      },
      (value) => {
        value.notarization.id = 'different';
      },
      (value) => {
        value.installation.archiveSha256 = '0'.repeat(64);
      },
      (value) => {
        value.installation.reviewer = '';
      },
      (value) => {
        value.verificationLogSha256 = '0'.repeat(64);
      },
      (value) => {
        delete value.checks.stapleValidated;
      },
      (value) => {
        value.checks.launchSucceeded = false;
      },
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(report);
      mutate(invalid);
      expect(() => validateMacosReleaseReport(invalid, expected)).toThrow('macOS release evidence');
    }
    expect(() =>
      validateMacosReleaseReport(report, {
        ...expected,
        notarization: { ...notarization, status: 'Invalid' },
      }),
    ).toThrow('macOS release evidence');
  });

  it('requires macOS evidence and binds packaged application files to the validated build', () => {
    const root = artifactFixture();
    writeJson(root, 'package.json', { version: '0.1.0-rc.3' });
    expect(collectMacosArtifactPaths(root)).toEqual([]);
    const packaged = path.join(root, macosBundlePath, 'Contents/Resources/app');
    fs.mkdirSync(packaged, { recursive: true });
    for (const relative of ['dist/client', 'dist/server', 'drizzle', 'package.json']) {
      fs.mkdirSync(path.dirname(path.join(packaged, relative)), { recursive: true });
      fs.cpSync(path.join(root, relative), path.join(packaged, relative), { recursive: true });
    }
    expect(() => validateMacosApplicationInputs(root)).not.toThrow();
    fs.writeFileSync(path.join(packaged, 'dist/client/assets/app.js'), 'stale');
    expect(() => validateMacosApplicationInputs(root)).toThrow('differs from validated build');
    fs.writeFileSync(path.join(root, 'dist/mac', macosZipName('0.1.0-rc.3')), 'unsigned');
    expect(() => collectMacosArtifactPaths(root)).toThrow('requires its release evidence');
  });

  it('allows only the one named macOS addition and requires its verified checkout', () => {
    const releaseDirectory = finalReleaseFixture();
    directories.push(releaseDirectory);
    const name = macosZipName('0.1.0-rc.3');
    fs.writeFileSync(path.join(releaseDirectory, name), 'unverified archive');
    const names = fs
      .readdirSync(releaseDirectory)
      .filter((entry) => entry !== 'SHA256SUMS.txt')
      .sort();
    fs.writeFileSync(
      path.join(releaseDirectory, 'SHA256SUMS.txt'),
      names
        .map(
          (entry) =>
            `${createHash('sha256')
              .update(fs.readFileSync(path.join(releaseDirectory, entry)))
              .digest('hex')}  ${entry}\n`,
        )
        .join(''),
    );
    expect(() =>
      collectFinalReleaseAssets({ releaseDirectory, gitSha, tag: 'v0.1.0-rc.3' }),
    ).toThrow('requires the verified release checkout');
    fs.renameSync(
      path.join(releaseDirectory, name),
      path.join(releaseDirectory, 'prd-genie-v0.1.0-rc.3-macos-x64.zip'),
    );
    expect(() =>
      collectFinalReleaseAssets({ releaseDirectory, gitSha, tag: 'v0.1.0-rc.3' }),
    ).toThrow('exact required asset inventory');
  });

  it('requires platform verification and exact prepared provenance for the seventh asset', () => {
    // Mock platform responses exercise policy wiring only, never claim Apple verification.
    const root = artifactFixture();
    writeEvidence(root);
    const version = '0.1.0-rc.3';
    writeJson(root, 'package.json', { version });
    const bundle = path.join(root, macosBundlePath);
    const app = path.join(bundle, 'Contents/Resources/app');
    fs.mkdirSync(app, { recursive: true });
    for (const relative of ['dist/client', 'dist/server', 'drizzle', 'package.json']) {
      fs.mkdirSync(path.dirname(path.join(app, relative)), { recursive: true });
      fs.cpSync(path.join(root, relative), path.join(app, relative), { recursive: true });
    }
    const native = [
      'Contents/MacOS/PRD Genie',
      'Contents/Resources/node',
      'Contents/Resources/jpeg-ocr',
    ];
    const header = Buffer.alloc(8);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(0x0100000c, 4);
    for (const relative of native) {
      fs.mkdirSync(path.dirname(path.join(bundle, relative)), { recursive: true });
      fs.writeFileSync(path.join(bundle, relative), header);
    }
    fs.writeFileSync(path.join(bundle, 'Contents/Info.plist'), 'Policy fixture');
    const archiveName = macosZipName(version);
    fs.writeFileSync(path.join(root, 'dist/mac', archiveName), 'Policy fixture archive');
    const notarization = {
      jobId: '12345678-1234-1234-1234-123456789abc',
      status: 'Accepted',
      sha256: 'a'.repeat(64),
      ticketContents: [{ arch: 'arm64', cdhash: 'a'.repeat(40) }],
    };
    writeJson(root, 'reports/macos-notarization.json', notarization);
    fs.writeFileSync(
      path.join(root, 'reports/macos-verification.txt'),
      'Mock platform observations, not release evidence',
    );
    writeJson(root, 'reports/macos-release.json', {});
    const hash = (relative: string) =>
      createHash('sha256')
        .update(fs.readFileSync(path.join(root, relative)))
        .digest('hex');
    const components = collectMacosArtifactPaths(root)
      .filter((file) => file.startsWith(`${macosBundlePath}/`))
      .map((file) => ({ path: file, sha256: hash(file) }));
    const nativeCode = components.filter((item) =>
      native.some((file) => item.path === `${macosBundlePath}/${file}`),
    );
    const archive = { path: `dist/mac/${archiveName}`, sha256: hash(`dist/mac/${archiveName}`) };
    const report = {
      schemaVersion: 1,
      passed: true,
      git: { sha: gitSha, clean: true },
      architecture: 'arm64',
      version,
      build: '112',
      bundleIdentifier: 'app.stillform.prdgenie',
      archive,
      components,
      nativeCode,
      teamIdentifier: 'ABCDE12345',
      signingName: 'Policy Fixture',
      signingAuthority: 'Developer ID Application: Policy Fixture (ABCDE12345)',
      notarization: { id: notarization.jobId, logSha256: hash('reports/macos-notarization.json') },
      verificationLogSha256: hash('reports/macos-verification.txt'),
      installation: {
        archiveSha256: archive.sha256,
        architecture: 'arm64',
        version,
        build: '112',
        macOSVersion: '26.0',
        verifiedAt: '2026-10-23T12:00:00Z',
        reviewer: 'Policy fixture',
      },
      checks: trueChecks(macosChecks),
    };
    writeJson(root, 'reports/macos-release.json', report);
    const plist: Record<string, string> = {
      PRDGenieGitCommit: gitSha,
      PRDGenieReleaseVersion: version,
      CFBundleShortVersionString: '0.1.0',
      CFBundleVersion: '112',
      CFBundleIdentifier: 'app.stillform.prdgenie',
    };
    const names = components.map((item) => item.path.slice('dist/mac/'.length));
    let signatureFailure = false;
    vi.mocked(execFileSync).mockImplementation(((command: string, args: string[]) => {
      if (command === 'git') return '112';
      if (command === '/usr/bin/plutil') return plist[args[1]!]!;
      if (command === '/usr/bin/zipinfo')
        return args[0] === '-1'
          ? names.join('\n')
          : [
              'Archive: fixture',
              'Zip file size: fixture',
              ...names.map((name) => `-rw-r--r-- fixture ${name}`),
              'Totals',
            ].join('\n');
      if (command === '/usr/bin/ditto') {
        fs.cpSync(bundle, path.join(args[3]!, 'PRD Genie.app'), { recursive: true });
        return '';
      }
      if (command === '/bin/sh')
        return `Authority=${report.signingAuthority}\nTeamIdentifier=${report.teamIdentifier}\nflags=0x10000(runtime)\nTimestamp=Oct 23, 2026\nCDHash=${'a'.repeat(40)}\n`;
      if (command === '/usr/bin/codesign' && signatureFailure) throw new Error('Invalid signature');
      if (['/usr/bin/codesign', '/usr/bin/xcrun', '/usr/sbin/spctl'].includes(command)) return '';
      throw new Error(`Unexpected command ${command}`);
    }) as typeof execFileSync);
    expect(() => validateMacosReleaseEvidence(root, gitSha)).not.toThrow();
    signatureFailure = true;
    expect(() => validateMacosReleaseEvidence(root, gitSha)).toThrow('Invalid signature');
    signatureFailure = false;
    plist.PRDGenieGitCommit = '0'.repeat(40);
    expect(() => validateMacosReleaseEvidence(root, gitSha)).toThrow('bundle identity');
    plist.PRDGenieGitCommit = gitSha;
    const releaseDirectory = finalReleaseFixture();
    directories.push(releaseDirectory);
    fs.copyFileSync(path.join(root, archive.path), path.join(releaseDirectory, archiveName));
    const publicProvenance = {
      git: { sha: gitSha, clean: true },
      claims: {
        releasePreparationAuthorized: true,
        releaseTag: `v${version}`,
        rightsConfirmed: true,
        sourceVisibility: 'public-github',
        publicTarget: publicReleaseTarget,
        publicName: publicProductName,
        validationStatus: 'passed',
        publicPromotionApprovalRequired: true,
      },
      artifacts: collectArtifactPaths(root).map((file) => ({ path: file, sha256: hash(file) })),
    };
    writeJson(releaseDirectory, `prd-genie-v${version}-provenance.json`, publicProvenance);
    const manifest = () =>
      fs.writeFileSync(
        path.join(releaseDirectory, 'SHA256SUMS.txt'),
        fs
          .readdirSync(releaseDirectory)
          .filter((file) => file !== 'SHA256SUMS.txt')
          .sort()
          .map(
            (file) =>
              `${createHash('sha256')
                .update(fs.readFileSync(path.join(releaseDirectory, file)))
                .digest('hex')}  ${file}\n`,
          )
          .join(''),
      );
    manifest();
    expect(
      collectFinalReleaseAssets({ releaseDirectory, root, gitSha, tag: `v${version}` }),
    ).toHaveLength(7);
    publicProvenance.claims.rightsConfirmed = false;
    writeJson(releaseDirectory, `prd-genie-v${version}-provenance.json`, publicProvenance);
    manifest();
    expect(() =>
      collectFinalReleaseAssets({ releaseDirectory, root, gitSha, tag: `v${version}` }),
    ).toThrow('authorized preparation provenance');
    fs.writeFileSync(path.join(releaseDirectory, archiveName), 'changed');
    manifest();
    expect(() =>
      collectFinalReleaseAssets({ releaseDirectory, root, gitSha, tag: `v${version}` }),
    ).toThrow('differs from the verified preparation');
    expect(() =>
      validateMacosReleaseEvidence(root, gitSha, path.join(releaseDirectory, archiveName)),
    ).toThrow('differs from the verified preparation');
    header.writeUInt32LE(0x01000007, 4);
    fs.writeFileSync(path.join(bundle, native[0]!), header);
    expect(() => validateMacosReleaseEvidence(root, gitSha)).toThrow('ARM64 only');
    header.writeUInt32LE(0x0100000c, 4);
    fs.writeFileSync(path.join(bundle, native[0]!), header);
    fs.writeFileSync(path.join(root, 'reports/macos-verification.txt'), '');
    expect(() => validateMacosReleaseEvidence(root, gitSha)).toThrow('transcript is empty');
    fs.writeFileSync(
      path.join(root, 'reports/macos-verification.txt'),
      'Mock platform observations, not release evidence',
    );
    fs.rmSync(path.join(bundle, 'Contents/Resources/jpeg-ocr'));
    expect(() => validateMacosReleaseEvidence(root, gitSha)).toThrow('native component is missing');
    fs.symlinkSync(path.join(bundle, native[0]!), path.join(bundle, 'Contents/Resources/jpeg-ocr'));
    expect(() => collectMacosArtifactPaths(root)).toThrow('symbolic links');
  });

  it('rejects ZIP aliases before extraction', () => {
    const name = 'PRD Genie.app/Contents/a';
    vi.mocked(execFileSync).mockImplementation(((command: string, args: string[]) => {
      if (command !== '/usr/bin/zipinfo') throw new Error('Extraction must not occur');
      const names = [name, 'PRD Genie.app/Contents//a'];
      return args[0] === '-1'
        ? names.join('\n')
        : ['Archive', 'Size', ...names.map((item) => `-rw-r--r-- fixture ${item}`), 'Totals'].join(
            '\n',
          );
    }) as typeof execFileSync);
    expect(() =>
      inspectMacosArchive(
        'fixture.zip',
        [{ path: `dist/mac/${name}`, sha256: 'a'.repeat(64) }],
        () => {},
      ),
    ).toThrow('entry inventory differs');
  });

  it('fails closed when any required artifact is absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-provenance-'));
    directories.push(root);
    expect(() => collectArtifactPaths(root)).toThrow('Required artifact is missing');
  });

  it('recursively inventories the complete artifact tree and rejects unsafe trees', () => {
    const root = artifactFixture();
    const artifacts = collectArtifactPaths(root);
    expect(artifacts).toContain('dist/client/assets/app.js');
    expect(artifacts).toContain('dist/server/server/index.js');
    expect(artifacts).toContain('drizzle/0000_initial.sql');

    fs.rmSync(path.join(root, 'dist/server'), { recursive: true });
    expect(() => collectArtifactPaths(root)).toThrow('Required artifact directory is missing');
    fs.mkdirSync(path.join(root, 'dist/server'), { recursive: true });
    fs.symlinkSync(path.join(root, 'package.json'), path.join(root, 'dist/server/link'));
    expect(() => collectArtifactPaths(root)).toThrow('symbolic link');

    fs.rmSync(path.join(root, 'dist/server'), { recursive: true });
    fs.symlinkSync(path.join(root, 'dist/client'), path.join(root, 'dist/server'));
    expect(() => collectArtifactPaths(root)).toThrow('directory is a symbolic link');
  });

  it('requires the exact successful full offline gate', () => {
    const root = artifactFixture();
    writeEvidence(root);
    expect(() => validateEvidenceReports(root, gitSha)).not.toThrow();

    const mutations: Array<(report: ReturnType<typeof offlineFixture>) => void> = [
      (report) => (report.schemaVersion = 2),
      (report) => (report.mode = 'quick'),
      (report) => (report.runtime.node = 'v20.0.0'),
      (report) => (report.git.sha = 'b'.repeat(40)),
      (report) => (report.git.clean = false),
      (report) => (report.passed = false),
      (report) => void report.results.pop(),
      (report) => (report.results[0]!.name = 'browser'),
      (report) => (report.results[0]!.status = 'failed'),
      (report) => (report.results[0]!.exitCode = 1),
    ];
    for (const mutate of mutations) {
      const report = offlineFixture();
      mutate(report);
      writeJson(root, 'reports/offline-ci.json', report);
      expect(() => validateEvidenceReports(root, gitSha)).toThrow('Offline CI evidence');
      writeEvidence(root);
    }
  });

  it('requires separate browser, accessibility, online audit, and Node gate evidence', () => {
    const root = artifactFixture();
    writeEvidence(root);
    for (const relative of [
      'reports/browser-e2e.json',
      'reports/accessibility-review.json',
      'reports/dependency-audit.json',
      'reports/node-22.json',
      'reports/node-24.json',
      'reports/production-smoke.json',
      'reports/test-coverage.json',
    ]) {
      const report = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')) as Record<
        string,
        unknown
      >;
      report.passed = false;
      writeJson(root, relative, report);
      expect(() => validateEvidenceReports(root, gitSha)).toThrow();
      writeEvidence(root);
    }
  });

  it('rejects incomplete browser, accessibility, audit, and production report shapes', () => {
    const root = artifactFixture();
    writeEvidence(root);
    const expectRejected = (relative: string, report: unknown) => {
      writeJson(root, relative, report);
      expect(() => validateEvidenceReports(root, gitSha)).toThrow();
      writeEvidence(root);
    };

    const emptySuites = browserFixture();
    emptySuites.playwright.suites = [];
    expectRejected('reports/browser-e2e.json', emptySuites);
    const missingBrowsers = browserFixture();
    missingBrowsers.playwright.config.projects = [{ name: 'chromium' }];
    expectRejected('reports/browser-e2e.json', missingBrowsers);
    const failedBrowser = browserFixture();
    failedBrowser.playwright.stats.unexpected = 1;
    expectRejected('reports/browser-e2e.json', failedBrowser);

    const missingWidth = accessibilityFixture();
    missingWidth.widths.pop();
    expectRejected('reports/accessibility-review.json', missingWidth);
    const missingAccessibilityCheck = accessibilityFixture();
    delete missingAccessibilityCheck.checks.keyboardNavigation;
    expectRejected('reports/accessibility-review.json', missingAccessibilityCheck);

    const duplicateAuditScope = dependencyAuditFixture();
    duplicateAuditScope.results[1]!.scope = 'production';
    expectRejected('reports/dependency-audit.json', duplicateAuditScope);
    const failedAudit = dependencyAuditFixture();
    failedAudit.results[0]!.exitCode = 1;
    expectRejected('reports/dependency-audit.json', failedAudit);

    const emptyProductionChecks = productionSmokeFixture();
    Object.assign(emptyProductionChecks, { checks: {} });
    expectRejected('reports/production-smoke.json', emptyProductionChecks);
    const missingProductionCheck = productionSmokeFixture();
    delete missingProductionCheck.checks.health;
    expectRejected('reports/production-smoke.json', missingProductionCheck);

    const incorrectTestTotal = testCoverageFixture();
    incorrectTestTotal.tests.passed -= 1;
    expectRejected('reports/test-coverage.json', incorrectTestTotal);
    const failedCoverage = testCoverageFixture();
    failedCoverage.coverage.branches.pct = 79;
    expectRejected('reports/test-coverage.json', failedCoverage);
  });

  it('recomputes every model-evaluation check instead of trusting its percentage', () => {
    const root = artifactFixture();
    writeEvidence(root);
    const mutations: Array<(report: ReturnType<typeof modelFixture>) => void> = [
      (report) => (report.gitSha = 'b'.repeat(40)),
      (report) => (report.dirtyWorkingTree = true),
      (report) => (report.model = ''),
      (report) => (report.modelDigest = 'bad'),
      (report) => (report.reviewModel = ''),
      (report) => (report.reviewModelDigest = 'bad'),
      (report) => (report.provider = 'openai'),
      (report) => (report.retrievalMode = 'vector'),
      (report) => (report.corpusVersion = 1),
      (report) => (report.scenarios = []),
      (report) => report.scenarios.push(structuredClone(report.scenarios[0]!)),
      (report) => (report.scenarios[0]!.id = 'substituted-scenario'),
      (report) => delete report.scenarios[0]!.checks.mentionsInterviewBase,
      (report) => (report.scenarios[0]!.checks.substitutedCheck = true),
      (report) => (report.scenarios[0]!.checks.mentionsInterviewBase = false),
      (report) => (report.scenarios[0]!.score.total += 1),
      (report) => delete report.adversarialStructuredReview.checks.avoidsHostileReviewClaims,
      (report) => (report.adversarialStructuredReview.checks.substitutedCheck = true),
      (report) => (report.adversarialStructuredReview.checks.avoidsHostileReviewClaims = false),
      (report) => (report.adversarialStructuredReview.score.percentage = 99),
      (report) => (report.adversarialStructuredReview.rawHostileChunkIds = []),
      (report) => report.adversarialStructuredReview.selectedCitationChunkIds.push('hostile-chunk'),
      (report) =>
        (report.adversarialStructuredReview.output.summary = 'PINEAPPLE_REVIEW_INJECTION'),
      (report) => delete report.structuredReview.checks.emitsSummary,
      (report) => delete report.structuredReview.checks.groundsReviewProse,
      (report) => (report.structuredReview.checks.substitutedCheck = true),
      (report) => (report.structuredReview.checks.emitsSummary = false),
      (report) => (report.structuredReview.score.percentage = 99),
      (report) => delete report.persistence.allProjectsPersisted,
      (report) => (report.persistence.substitutedCheck = true),
      (report) => (report.persistence.allProjectsPersisted = false),
      (report) => (report.limitations = []),
      (report) => report.limitations.push(report.limitations[0]!),
      (report) => (report.score.total = 4),
    ];
    for (const mutate of mutations) {
      const report = modelFixture();
      mutate(report);
      writeJson(root, 'reports/model-evaluation.json', report);
      expect(() => validateEvidenceReports(root, gitSha)).toThrow('Model evaluation evidence');
      writeEvidence(root);
    }
  });

  it('requires complete normalized container evidence for the clean SHA', () => {
    const root = artifactFixture();
    writeEvidence(root);
    const mutations: Array<(report: ReturnType<typeof containerReportFixture>) => void> = [
      (report) => (report.schemaVersion = 2),
      (report) => (report.git.sha = 'b'.repeat(40)),
      (report) => (report.engine.name = ''),
      (report) => (report.engine.version = ''),
      (report) => (report.engine.platform = 'linux/amd64'),
      (report) => (report.image.reference = ''),
      (report) => (report.image.digest = 'bad'),
      (report) => (report.image.revision = 'b'.repeat(40)),
      (report) => (report.resources.containerName = ''),
      (report) => (report.resources.volumeNames = []),
      (report) => (report.checks.health = false),
      (report) => (report.checks.healthStatus = 'failed'),
      (report) => (report.checks.pendingFileCleanup = 1),
      (report) => (report.checks.invalidHostStatus = 200),
      (report) => (report.checks.runtimeUid = 0),
      (report) => (report.checks.runtimePid = 2),
      (report) => (report.checks.persistenceAfterRestart = false),
      (report) => (report.checks.gracefulSigterm = false),
      (report) => (report.checks.shutdownSignal = 'SIGKILL'),
      (report) => (report.checks.stopMilliseconds = -1),
      (report) => (report.checks.shutdownLogSha256 = 'bad'),
      (report) => (report.checks.cleanupComplete = false),
    ];
    for (const mutate of mutations) {
      const report = containerReportFixture();
      mutate(report);
      writeJson(root, 'reports/container-smoke.json', report);
      expect(() => validateEvidenceReports(root, gitSha)).toThrow('Container smoke evidence');
      writeEvidence(root);
    }
    expect(validateContainerSmokeReport(containerReportFixture(), gitSha)).toBe(true);
    expect(validateContainerSmokeReport(null, gitSha)).toBe(false);
  });

  it('binds public provenance preparation to identity, rights, validation, and artifacts', () => {
    const artifacts = [
      { path: 'release.tar.gz', sha256: 'b'.repeat(64) },
      { path: 'sbom.json', sha256: 'c'.repeat(64) },
    ];
    const valid = provenanceAuthorizationFixture(artifacts);
    expect(() =>
      validatePublicProvenanceAuthorization({
        authorization: valid,
        artifacts,
        gitSha,
        clean: true,
        tagSha: gitSha,
      }),
    ).not.toThrow();

    const mutations: Array<
      (authorization: ReturnType<typeof provenanceAuthorizationFixture>) => void
    > = [
      (authorization) => (authorization.authorized = false),
      (authorization) => (authorization.schemaVersion = 1),
      (authorization) => (authorization.approvalScope = 'private'),
      (authorization) => (authorization.gitSha = 'c'.repeat(40)),
      (authorization) => (authorization.tag = 'latest'),
      (authorization) => (authorization.publicTarget = 'https://example.com/repo'),
      (authorization) => (authorization.publicName = 'Different name'),
      (authorization) => (authorization.rightsConfirmed = false),
      (authorization) => (authorization.validationStatus = 'failed'),
      (authorization) => (authorization.knownLimitations = []),
      (authorization) => authorization.knownLimitations.push(authorization.knownLimitations[0]!),
      (authorization) => (authorization.unresolvedIssues = ['']),
      (authorization) => (authorization.artifacts = []),
      (authorization) => (authorization.artifacts[0]!.sha256 = 'e'.repeat(64)),
      (authorization) => (authorization.artifacts = [artifacts[0]!, artifacts[0]!]),
      (authorization) =>
        (authorization.artifacts = [{ path: '../secret', sha256: 'e'.repeat(64) }]),
      (authorization) =>
        (authorization.artifacts = [{ path: '/tmp/file', sha256: 'e'.repeat(64) }]),
      (authorization) =>
        (authorization.artifacts = [{ path: 'bad\\path', sha256: 'e'.repeat(64) }]),
    ];
    for (const mutate of mutations) {
      const authorization = structuredClone(valid);
      mutate(authorization);
      expect(() =>
        validatePublicProvenanceAuthorization({
          authorization,
          artifacts,
          gitSha,
          clean: true,
          tagSha: gitSha,
        }),
      ).toThrow();
    }
    expect(() =>
      validatePublicProvenanceAuthorization({
        authorization: valid,
        artifacts,
        gitSha,
        clean: false,
        tagSha: gitSha,
      }),
    ).toThrow('clean working tree');
    expect(() =>
      validatePublicProvenanceAuthorization({
        authorization: valid,
        artifacts,
        gitSha,
        clean: true,
        tagSha: 'd'.repeat(40),
      }),
    ).toThrow('does not point');
  });

  it('binds final promotion approval to the annotated tag and every finished asset byte', () => {
    const releaseAssets = [
      { path: 'SHA256SUMS.txt', sha256: 'b'.repeat(64) },
      { path: 'prd-genie-a.tar.gz', sha256: 'c'.repeat(64) },
      { path: 'prd-genie-v0.1.0-rc.3-provenance.json', sha256: 'd'.repeat(64) },
    ];
    const tagObjectSha = 'f'.repeat(40);
    const valid = promotionApprovalFixture(releaseAssets, tagObjectSha);
    expect(() =>
      validateFinalPromotionApproval({
        approval: valid,
        releaseAssets,
        gitSha,
        clean: true,
        tagSha: gitSha,
        tagObjectSha,
      }),
    ).not.toThrow();

    const mutations: Array<(approval: ReturnType<typeof promotionApprovalFixture>) => void> = [
      (approval) => (approval.approved = false),
      (approval) => (approval.schemaVersion = 1),
      (approval) => (approval.approvalScope = 'public-github-release'),
      (approval) => (approval.gitSha = 'c'.repeat(40)),
      (approval) => (approval.tag = 'latest'),
      (approval) => (approval.tagObjectSha = 'e'.repeat(40)),
      (approval) => (approval.publicTarget = 'https://example.com/repo'),
      (approval) => (approval.publicName = 'Different name'),
      (approval) => (approval.rightsConfirmed = false),
      (approval) => (approval.validationStatus = 'failed'),
      (approval) => (approval.knownLimitations = []),
      (approval) => (approval.unresolvedIssues = ['']),
      (approval) => (approval.releaseAssets = []),
      (approval) => (approval.releaseAssets[0]!.sha256 = 'a'.repeat(64)),
      (approval) => (approval.releaseAssets = [releaseAssets[0]!, releaseAssets[0]!]),
    ];
    for (const mutate of mutations) {
      const approval = structuredClone(valid);
      mutate(approval);
      expect(() =>
        validateFinalPromotionApproval({
          approval,
          releaseAssets,
          gitSha,
          clean: true,
          tagSha: gitSha,
          tagObjectSha,
        }),
      ).toThrow();
    }
    expect(() =>
      validateFinalPromotionApproval({
        approval: valid,
        releaseAssets,
        gitSha,
        clean: false,
        tagSha: gitSha,
        tagObjectSha,
      }),
    ).toThrow('clean working tree');
    expect(() =>
      validateFinalPromotionApproval({
        approval: valid,
        releaseAssets,
        gitSha,
        clean: true,
        tagSha: 'e'.repeat(40),
        tagObjectSha,
      }),
    ).toThrow('does not point');
    expect(() =>
      validateFinalPromotionApproval({
        approval: valid,
        releaseAssets,
        gitSha,
        clean: true,
        tagSha: gitSha,
        tagObjectSha: 'e'.repeat(40),
      }),
    ).toThrow('annotated tag object');
  });

  it('requires the exact six-file final inventory and a manifest for every public payload', () => {
    const releaseDirectory = finalReleaseFixture();
    directories.push(releaseDirectory);
    const assets = collectFinalReleaseAssets({
      releaseDirectory,
      gitSha,
      tag: 'v0.1.0-rc.3',
    });
    expect(assets).toHaveLength(6);
    expect(assets.map((asset) => asset.path)).toContain('SHA256SUMS.txt');

    fs.writeFileSync(path.join(releaseDirectory, 'prd-genie-v0.1.0-rc.3-licenses.json'), 'changed');
    expect(() =>
      collectFinalReleaseAssets({ releaseDirectory, gitSha, tag: 'v0.1.0-rc.3' }),
    ).toThrow('checksum manifest');

    const extraDirectory = finalReleaseFixture();
    directories.push(extraDirectory);
    fs.writeFileSync(path.join(extraDirectory, 'unexpected.txt'), 'unexpected');
    expect(() =>
      collectFinalReleaseAssets({
        releaseDirectory: extraDirectory,
        gitSha,
        tag: 'v0.1.0-rc.3',
      }),
    ).toThrow('exact required asset inventory');

    const linkedDirectory = finalReleaseFixture();
    directories.push(linkedDirectory);
    fs.rmSync(path.join(linkedDirectory, 'prd-genie-v0.1.0-rc.3-licenses.json'));
    fs.symlinkSync(
      path.join(linkedDirectory, 'prd-genie-v0.1.0-rc.3-provenance.json'),
      path.join(linkedDirectory, 'prd-genie-v0.1.0-rc.3-licenses.json'),
    );
    expect(() =>
      collectFinalReleaseAssets({
        releaseDirectory: linkedDirectory,
        gitSha,
        tag: 'v0.1.0-rc.3',
      }),
    ).toThrow('regular files');
  });

  it.each(['consistent', 'significant', 'critical', 'severe', 'urgent', 'always', 'guarantee'])(
    'detects the unsupported qualifier %s',
    (qualifier) => expect(containsUnsupportedQualifier(`This is ${qualifier}.`)).toBe(true),
  );

  it.each(['e.g.', 'for example', 'for instance', 'such as'])(
    'detects the invented-example phrase %s',
    (phrase) => expect(containsInventedExample(`Add ${phrase} a synthetic target.`)).toBe(true),
  );

  it('parses the structured stopped container status even when the CLI exits nonzero', () => {
    expect(parseContainerSystemStatus('{"status":"unregistered"}')).toBe('unregistered');
    expect(() => parseContainerSystemStatus('{}')).toThrow('unreadable service status');
    expect(() => parseContainerSystemStatus('')).toThrow('unreadable service status');
  });

  function artifactFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-provenance-'));
    directories.push(root);
    for (const relative of requiredArtifactFiles) {
      const absolute = path.join(root, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, '{}');
    }
    const files = {
      'dist/client/assets/app.js': 'client',
      'dist/client/index.html': 'index',
      'dist/server/server/index.js': 'server',
      'drizzle/0000_initial.sql': 'migration',
    };
    for (const [relative, content] of Object.entries(files)) {
      const absolute = path.join(root, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content);
    }
    for (const relative of requiredArtifactDirectories) {
      fs.mkdirSync(path.join(root, relative), { recursive: true });
    }
    return root;
  }

  function writeEvidence(root: string): void {
    writeJson(root, 'reports/offline-ci.json', offlineFixture());
    writeJson(root, 'reports/browser-e2e.json', browserFixture());
    writeJson(root, 'reports/accessibility-review.json', accessibilityFixture());
    writeJson(root, 'reports/dependency-audit.json', dependencyAuditFixture());
    writeJson(root, 'reports/node-22.json', nodeFixture(22));
    writeJson(root, 'reports/node-24.json', nodeFixture(24));
    writeJson(root, 'reports/production-smoke.json', productionSmokeFixture());
    writeJson(root, 'reports/test-coverage.json', testCoverageFixture());
    writeJson(root, 'reports/model-evaluation.json', modelFixture());
    writeJson(root, 'reports/container-smoke.json', containerReportFixture());
  }
});

function browserFixture() {
  return {
    schemaVersion: 1,
    git: { sha: gitSha, clean: true },
    passed: true,
    exitCode: 0,
    command: 'playwright test',
    playwright: {
      config: { projects: requiredBrowserProjects.map((name) => ({ name })) },
      suites: [
        {
          specs: requiredBrowserProjects.map((projectName) => ({
            tests: [{ projectName }],
          })),
        },
      ],
      stats: { expected: requiredBrowserProjects.length, unexpected: 0 },
    },
  };
}

function accessibilityFixture() {
  return {
    schemaVersion: 1,
    git: { sha: gitSha, clean: true },
    passed: true,
    reviewMethod: 'manual-browser-and-source-review',
    widths: [...requiredAccessibilityWidths],
    checks: trueChecks(requiredAccessibilityChecks) as Record<string, boolean | undefined>,
    materialWarnings: [],
  };
}

function dependencyAuditFixture() {
  return {
    schemaVersion: 1,
    git: { sha: gitSha, clean: true },
    online: true,
    passed: true,
    results: ['production', 'full'].map((scope) => ({
      scope,
      passed: true,
      exitCode: 0,
      auditReportVersion: 2,
      vulnerabilities: { high: 0, critical: 0 },
    })),
  };
}

function productionSmokeFixture() {
  return {
    schemaVersion: 1,
    git: { sha: gitSha, clean: true },
    childPidRecorded: true,
    command: 'node dist/server/server/index.js',
    passed: true,
    checks: trueChecks(requiredProductionSmokeChecks) as Record<string, boolean | undefined>,
  };
}

function testCoverageFixture() {
  const metric = { total: 100, covered: 95, skipped: 0, pct: 95 };
  return {
    schemaVersion: 1,
    git: { sha: gitSha, clean: true },
    command: 'vitest run --coverage --reporter=json',
    exitCode: 0,
    passed: true,
    suites: { files: 19, total: 45, passed: 45, failed: 0, pending: 0 },
    tests: { total: 233, passed: 233, failed: 0, pending: 0, todo: 0 },
    coverage: {
      statements: { ...metric },
      branches: { ...metric },
      functions: { ...metric },
      lines: { ...metric },
    },
  };
}

function offlineFixture() {
  return {
    schemaVersion: 1,
    mode: 'full',
    runtime: { node: 'v22.23.0' },
    git: { sha: gitSha, clean: true },
    passed: true,
    results: requiredOfflineSteps.map((name) => ({ name, status: 'passed', exitCode: 0 })),
  };
}

function nodeFixture(major: 22 | 24) {
  return {
    schemaVersion: 1,
    mode: 'quick',
    runtime: { node: `v${major}.23.0` },
    git: { sha: gitSha, clean: true },
    passed: true,
    results: requiredOfflineSteps
      .filter((name) => name !== 'browser')
      .map((name) => ({ name, status: 'passed', exitCode: 0 })),
  };
}

function modelFixture() {
  const scenarios = Object.entries(requiredModelScenarioChecks).map(([id, names]) => ({
    id,
    checks: trueChecks(names),
    score: { passed: names.length, total: names.length, percentage: 100 },
  }));
  const reviewChecks = trueChecks(requiredStructuredReviewChecks);
  const adversarialReviewChecks = trueChecks(requiredAdversarialStructuredReviewChecks);
  const persistence = trueChecks(requiredPersistenceChecks);
  const total =
    scenarios.reduce((sum, scenario) => sum + scenario.score.total, 0) +
    requiredAdversarialStructuredReviewChecks.length +
    requiredStructuredReviewChecks.length +
    requiredPersistenceChecks.length;
  return {
    gitSha,
    dirtyWorkingTree: false,
    model: 'test-model',
    modelDigest: 'd'.repeat(64),
    reviewModel: 'test-review-model',
    reviewModelDigest: 'e'.repeat(64),
    provider: 'ollama',
    retrievalMode: 'lexical',
    corpusVersion: 3,
    scenarios,
    adversarialStructuredReview: {
      marker: 'PINEAPPLE_REVIEW_INJECTION',
      rawHostileChunkIds: ['hostile-chunk'],
      selectedCitationChunkIds: ['safe-chunk'],
      findingCitationChunkIds: [],
      output: {
        summary: 'The Problem section is empty.',
        rationales: ['The Problem section is empty.'],
        proposedMarkdown: [null],
      },
      checks: adversarialReviewChecks,
      score: {
        passed: requiredAdversarialStructuredReviewChecks.length,
        total: requiredAdversarialStructuredReviewChecks.length,
        percentage: 100,
      },
    },
    structuredReview: {
      checks: reviewChecks,
      score: {
        passed: requiredStructuredReviewChecks.length,
        total: requiredStructuredReviewChecks.length,
        percentage: 100,
      },
    },
    persistence,
    score: { passed: total, total, percentage: 100 },
    limitations: ['Synthetic corpus only.'],
  };
}

function containerReportFixture() {
  return {
    schemaVersion: 1,
    git: { sha: gitSha, clean: true },
    engine: { name: 'Apple Container', version: '0.9.0', platform: 'linux/arm64' },
    image: { reference: 'prd-genie:test', digest: `sha256:${'e'.repeat(64)}`, revision: gitSha },
    resources: { containerName: 'prd-genie-test', volumeNames: ['data-test', 'models-test'] },
    checks: {
      health: true,
      healthStatus: 'ok',
      pendingFileCleanup: 0,
      invalidHostStatus: 421,
      runtimeUid: 1000,
      runtimePid: 1,
      persistenceAfterRestart: true,
      gracefulSigterm: true,
      shutdownSignal: 'SIGTERM',
      stopMilliseconds: 500,
      shutdownLogSha256: 'f'.repeat(64),
      cleanupComplete: true,
    },
  };
}

function trueChecks(names: string[]): Record<string, boolean> {
  return Object.fromEntries(names.map((name) => [name, true]));
}

function provenanceAuthorizationFixture(artifacts: Array<{ path: string; sha256: string }>) {
  return {
    schemaVersion: 2,
    approvalScope: 'public-github-provenance-preparation',
    authorized: true,
    gitSha,
    tag: 'v0.1.0-rc.2',
    publicTarget: publicReleaseTarget,
    publicName: publicProductName,
    rightsConfirmed: true,
    validationStatus: 'passed',
    knownLimitations: ['Native Windows validation is pending.'],
    unresolvedIssues: ['Native Windows validation is not yet recorded.'],
    artifacts,
  };
}

function promotionApprovalFixture(
  releaseAssets: Array<{ path: string; sha256: string }>,
  tagObjectSha: string,
) {
  return {
    schemaVersion: 2,
    approvalScope: 'public-github-promotion',
    approved: true,
    gitSha,
    tag: 'v0.1.0-rc.3',
    tagObjectSha,
    publicTarget: publicReleaseTarget,
    publicName: publicProductName,
    rightsConfirmed: true,
    validationStatus: 'passed',
    knownLimitations: ['Native Windows validation is pending.'],
    unresolvedIssues: ['Native Windows validation is not yet recorded.'],
    releaseAssets,
  };
}

function finalReleaseFixture(): string {
  const releaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-release-'));
  const tag = 'v0.1.0-rc.3';
  const payloadNames = [
    `prd-genie-${gitSha.slice(0, 12)}.tar.gz`,
    `prd-genie-${tag}-evidence.tar.gz`,
    `prd-genie-${tag}-licenses.json`,
    `prd-genie-${tag}-provenance.json`,
    `prd-genie-${tag}-sbom.cdx.json`,
  ].sort();
  for (const name of payloadNames) fs.writeFileSync(path.join(releaseDirectory, name), name);
  const manifest = payloadNames
    .map((name) => {
      const sha256 = createHash('sha256')
        .update(fs.readFileSync(path.join(releaseDirectory, name)))
        .digest('hex');
      return `${sha256}  ${name}`;
    })
    .join('\n');
  fs.writeFileSync(path.join(releaseDirectory, 'SHA256SUMS.txt'), `${manifest}\n`);
  return releaseDirectory;
}

function writeJson(root: string, relative: string, value: unknown): void {
  fs.writeFileSync(path.join(root, relative), JSON.stringify(value));
}
