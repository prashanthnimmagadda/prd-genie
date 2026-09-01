import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectArtifactPaths,
  containsInventedExample,
  containsUnsupportedQualifier,
  parseContainerSystemStatus,
  publicProductName,
  publicReleaseTarget,
  requiredAccessibilityChecks,
  requiredAccessibilityWidths,
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
  validatePublicApproval,
} from '../../scripts/provenance-policy.mjs';

const gitSha = 'a'.repeat(40);

describe('release provenance policy', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
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
      (report) => delete report.structuredReview.checks.emitsSummary,
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

  it('binds public approval to identity, rights, validation, issues, and artifacts', () => {
    const artifacts = [
      { path: 'release.tar.gz', sha256: 'b'.repeat(64) },
      { path: 'sbom.json', sha256: 'c'.repeat(64) },
    ];
    const valid = approvalFixture(artifacts);
    expect(() =>
      validatePublicApproval({ approval: valid, artifacts, gitSha, clean: true, tagSha: gitSha }),
    ).not.toThrow();

    const mutations: Array<(approval: ReturnType<typeof approvalFixture>) => void> = [
      (approval) => (approval.approved = false),
      (approval) => (approval.schemaVersion = 2),
      (approval) => (approval.approvalScope = 'private'),
      (approval) => (approval.gitSha = 'c'.repeat(40)),
      (approval) => (approval.tag = 'latest'),
      (approval) => (approval.publicTarget = 'https://example.com/repo'),
      (approval) => (approval.publicName = 'Different name'),
      (approval) => (approval.rightsConfirmed = false),
      (approval) => (approval.validationStatus = 'failed'),
      (approval) => (approval.knownLimitations = []),
      (approval) => approval.knownLimitations.push(approval.knownLimitations[0]!),
      (approval) => (approval.unresolvedIssues = ['']),
      (approval) => (approval.artifacts = []),
      (approval) => (approval.artifacts[0]!.sha256 = 'e'.repeat(64)),
      (approval) => (approval.artifacts = [artifacts[0]!, artifacts[0]!]),
      (approval) => (approval.artifacts = [{ path: '../secret', sha256: 'e'.repeat(64) }]),
      (approval) => (approval.artifacts = [{ path: '/tmp/file', sha256: 'e'.repeat(64) }]),
      (approval) => (approval.artifacts = [{ path: 'bad\\path', sha256: 'e'.repeat(64) }]),
    ];
    for (const mutate of mutations) {
      const approval = structuredClone(valid);
      mutate(approval);
      expect(() =>
        validatePublicApproval({ approval, artifacts, gitSha, clean: true, tagSha: gitSha }),
      ).toThrow();
    }
    expect(() =>
      validatePublicApproval({ approval: valid, artifacts, gitSha, clean: false, tagSha: gitSha }),
    ).toThrow('clean working tree');
    expect(() =>
      validatePublicApproval({
        approval: valid,
        artifacts,
        gitSha,
        clean: true,
        tagSha: 'd'.repeat(40),
      }),
    ).toThrow('does not point');
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
  const persistence = trueChecks(requiredPersistenceChecks);
  const total =
    scenarios.reduce((sum, scenario) => sum + scenario.score.total, 0) +
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
    corpusVersion: 2,
    scenarios,
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

function approvalFixture(artifacts: Array<{ path: string; sha256: string }>) {
  return {
    schemaVersion: 1,
    approvalScope: 'public-github-release',
    approved: true,
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

function writeJson(root: string, relative: string, value: unknown): void {
  fs.writeFileSync(path.join(root, relative), JSON.stringify(value));
}
