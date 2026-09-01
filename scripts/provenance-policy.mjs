import fs from 'node:fs';
import path from 'node:path';

export const publicProductName = 'PRD Genie';
export const publicReleaseTarget = 'https://github.com/prashanthnimmagadda/prd-genie';
export const requiredOfflineSteps = [
  'host-policy',
  'workflow-policy',
  'content',
  'format',
  'lint',
  'types',
  'coverage',
  'build',
  'dependency-audit',
  'licenses',
  'sbom',
  'browser',
];
export const requiredModelScenarioChecks = {
  'grounded-problem': [
    'mentionsInterviewBase',
    'mentionsObservedLoss',
    'mentionsReconstructionCost',
    'avoidsUnsupportedBusinessClaims',
    'avoidsSolutionScope',
    'returnsPrdOnly',
    'meaningfulLength',
    'emitsCitation',
    'persistsCompletedRun',
    'appliesExactOutput',
  ],
  'conflicting-evidence': [
    'includesFirstRate',
    'includesSecondRate',
    'labelsConflict',
    'avoidsFalseAverage',
    'returnsPrdOnly',
    'meaningfulLength',
    'emitsCitation',
    'persistsCompletedRun',
    'appliesExactOutput',
  ],
  'sparse-qualitative-evidence': [
    'describesFindingDecisions',
    'describesReviewUncertainty',
    'avoidsInventedMetrics',
    'avoidsFinancialClaims',
    'returnsPrdOnly',
    'meaningfulLength',
    'emitsCitation',
    'persistsCompletedRun',
    'appliesExactOutput',
  ],
  'testable-requirements': [
    'includesSaveInterval',
    'includesRecoveryTime',
    'usesNormativeLanguage',
    'includesTestCondition',
    'avoidsInventedRequirements',
    'returnsPrdOnly',
    'meaningfulLength',
    'emitsCitation',
    'persistsCompletedRun',
    'appliesExactOutput',
  ],
  'prompt-injection-resistance': [
    'includesObservedCount',
    'includesReconstructionTime',
    'ignoresInjectedReply',
    'avoidsInstructionNarration',
    'avoidsInjectedCausalClaims',
    'avoidsUnsupportedNormativeLanguage',
    'returnsPrdOnly',
    'meaningfulLength',
    'emitsCitation',
    'persistsCompletedRun',
    'appliesExactOutput',
  ],
};
export const requiredStructuredReviewChecks = [
  'emitsSummary',
  'usesOneToThreeSummarySentences',
  'emitsFinding',
  'targetsKnownSections',
  'bindsRevision',
  'givesRationale',
  'bindsPatchTargets',
  'preservesPatchPreimages',
  'groundsFindingsInSourceOrPrd',
  'groundsReviewProse',
  'avoidsUnsupportedReviewQualifiers',
  'avoidsUnsupportedTargetRecommendations',
  'avoidsInventedExamples',
];
export const requiredPersistenceChecks = ['allProjectsPersisted', 'reviewHistoryPersisted'];
export const requiredBrowserProjects = ['chromium', 'firefox', 'webkit'];
export const requiredAccessibilityWidths = [320, 375, 414, 768, 1440];
export const requiredAccessibilityChecks = [
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
export const requiredProductionSmokeChecks = [
  'health',
  'client',
  'projectCreated',
  'markdownExport',
  'persistenceAfterRestart',
  'gracefulSigterm',
  'cleanupComplete',
];

export const requiredArtifactFiles = [
  'Dockerfile',
  'docker-compose.yml',
  'package.json',
  'package-lock.json',
  'scripts/container-entrypoint.sh',
  'scripts/provenance.mjs',
  'scripts/provenance-policy.mjs',
  'scripts/record-container-smoke.mjs',
  'evaluations/ollama-qwen35-review.Modelfile',
  'reports/container-smoke.json',
  'reports/browser-e2e.json',
  'reports/accessibility-review.json',
  'reports/dependency-audit.json',
  'reports/licenses.json',
  'reports/model-evaluation.json',
  'reports/offline-ci.json',
  'reports/node-22.json',
  'reports/node-24.json',
  'reports/production-smoke.json',
  'reports/sbom.cdx.json',
  'coverage/coverage-summary.json',
];
export const requiredArtifactDirectories = ['dist/client', 'dist/server', 'drizzle'];

export function collectArtifactPaths(root) {
  const collected = [...requiredArtifactFiles];
  for (const relative of requiredArtifactFiles) requireRegularFile(root, relative);
  for (const relative of requiredArtifactDirectories) {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) {
      throw new Error(`Required artifact directory is a symbolic link: ${relative}`);
    }
    if (!stat?.isDirectory()) {
      throw new Error(`Required artifact directory is missing: ${relative}`);
    }
    walk(root, absolute, collected);
  }
  return [...new Set(collected)].sort();
}

export function validateEvidenceReports(root, gitSha) {
  const offline = readJson(root, 'reports/offline-ci.json');
  const browser = readJson(root, 'reports/browser-e2e.json');
  const accessibility = readJson(root, 'reports/accessibility-review.json');
  const dependencyAudit = readJson(root, 'reports/dependency-audit.json');
  const node22 = readJson(root, 'reports/node-22.json');
  const node24 = readJson(root, 'reports/node-24.json');
  const productionSmoke = readJson(root, 'reports/production-smoke.json');
  const model = readJson(root, 'reports/model-evaluation.json');
  const container = readJson(root, 'reports/container-smoke.json');
  if (
    offline.schemaVersion !== 1 ||
    offline.mode !== 'full' ||
    offline.git?.sha !== gitSha ||
    offline.git?.clean !== true ||
    offline.passed !== true ||
    !/^v?(?:22|24)\./.test(offline.runtime?.node ?? '') ||
    !hasExactPassedSteps(offline.results)
  ) {
    throw new Error('Offline CI evidence does not validate the clean current SHA.');
  }
  if (
    !validSimpleEvidence(browser, gitSha) ||
    browser.command !== 'playwright test' ||
    browser.exitCode !== 0 ||
    !validBrowserReport(browser.playwright)
  ) {
    throw new Error('Browser evidence does not validate the clean current SHA.');
  }
  if (
    !validSimpleEvidence(accessibility, gitSha) ||
    accessibility.reviewMethod !== 'manual-browser-and-source-review' ||
    !sameNumberSet(accessibility.widths, requiredAccessibilityWidths) ||
    !exactTrueChecks(accessibility.checks, requiredAccessibilityChecks) ||
    !Array.isArray(accessibility.materialWarnings) ||
    accessibility.materialWarnings.length !== 0
  ) {
    throw new Error('Accessibility evidence does not validate the clean current SHA.');
  }
  if (
    !validSimpleEvidence(dependencyAudit, gitSha) ||
    dependencyAudit.online !== true ||
    !Array.isArray(dependencyAudit.results) ||
    dependencyAudit.results.length !== 2 ||
    !sameStringSet(
      dependencyAudit.results.map((result) => result?.scope),
      ['production', 'full'],
    ) ||
    dependencyAudit.results.some(
      (result) =>
        result?.passed !== true ||
        result?.exitCode !== 0 ||
        !Number.isInteger(result?.auditReportVersion) ||
        (result.vulnerabilities?.high ?? 0) !== 0 ||
        (result.vulnerabilities?.critical ?? 0) !== 0,
    )
  ) {
    throw new Error('Online dependency evidence does not validate the clean current SHA.');
  }
  if (!validNodeGate(node22, gitSha, 22) || !validNodeGate(node24, gitSha, 24)) {
    throw new Error('Node 22 and Node 24 evidence does not validate the clean current SHA.');
  }
  if (
    !validSimpleEvidence(productionSmoke, gitSha) ||
    productionSmoke.command !== 'node dist/server/server/index.js' ||
    productionSmoke.childPidRecorded !== true ||
    !exactTrueChecks(productionSmoke.checks, requiredProductionSmokeChecks)
  ) {
    throw new Error('Production runtime evidence does not validate the clean current SHA.');
  }
  if (!validModelEvidence(model, gitSha)) {
    throw new Error('Model evaluation evidence does not validate the clean current SHA.');
  }
  if (!validateContainerSmokeReport(container, gitSha)) {
    throw new Error('Container smoke evidence does not validate the clean current SHA.');
  }
}

function validBrowserReport(report) {
  if (!report || typeof report !== 'object') return false;
  const configuredProjects = report.config?.projects?.map((project) =>
    typeof project === 'string' ? project : project?.name,
  );
  if (!sameStringSet(configuredProjects, requiredBrowserProjects)) return false;
  if (
    !Array.isArray(report.suites) ||
    report.suites.length === 0 ||
    !Number.isInteger(report.stats?.expected) ||
    report.stats.expected < requiredBrowserProjects.length ||
    report.stats.unexpected !== 0
  ) {
    return false;
  }
  const executedProjects = new Set();
  const visit = (suite) => {
    for (const spec of suite?.specs ?? []) {
      for (const test of spec?.tests ?? []) executedProjects.add(test?.projectName);
    }
    for (const child of suite?.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  return requiredBrowserProjects.every((project) => executedProjects.has(project));
}

function exactTrueChecks(checks, required) {
  return (
    checks !== null &&
    typeof checks === 'object' &&
    !Array.isArray(checks) &&
    sameStringSet(Object.keys(checks), required) &&
    required.every((name) => checks[name] === true)
  );
}

function sameStringSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.every((value) => typeof value === 'string') &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  );
}

function sameNumberSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.every((value) => Number.isInteger(value)) &&
    JSON.stringify([...actual].sort((left, right) => left - right)) ===
      JSON.stringify([...expected].sort((left, right) => left - right))
  );
}

function validSimpleEvidence(report, gitSha) {
  return (
    report?.schemaVersion === 1 &&
    report.git?.sha === gitSha &&
    report.git?.clean === true &&
    report.passed === true
  );
}

function validNodeGate(report, gitSha, major) {
  const expectedSteps = requiredOfflineSteps.filter((step) => step !== 'browser');
  if (
    report?.schemaVersion !== 1 ||
    report.mode !== 'quick' ||
    report.git?.sha !== gitSha ||
    report.git?.clean !== true ||
    report.passed !== true ||
    !new RegExp(`^v${major}\\.`).test(report.runtime?.node ?? '') ||
    !Array.isArray(report.results) ||
    report.results.length !== expectedSteps.length
  ) {
    return false;
  }
  const byName = new Map(report.results.map((result) => [result?.name, result]));
  return expectedSteps.every((name) => {
    const result = byName.get(name);
    return result?.status === 'passed' && result?.exitCode === 0;
  });
}

export function validatePublicApproval({ approval, artifacts, gitSha, clean, tagSha }) {
  if (approval?.approved !== true) throw new Error('Public promotion is not approved.');
  if (approval.schemaVersion !== 1 || approval.approvalScope !== 'public-github-release') {
    throw new Error('Approval has an unsupported schema or scope.');
  }
  if (!/^[a-f0-9]{40}$/.test(approval.gitSha ?? '') || approval.gitSha !== gitSha) {
    throw new Error('Approval does not match the current Git SHA.');
  }
  if (clean !== true) throw new Error('Public provenance requires a clean working tree.');
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(approval.tag ?? '')) {
    throw new Error('Approval does not contain a valid release tag.');
  }
  if (tagSha !== gitSha)
    throw new Error('The approved release tag does not point to the current SHA.');
  if (approval.publicTarget !== publicReleaseTarget) {
    throw new Error('Approval does not match the public release target.');
  }
  if (approval.publicName !== publicProductName) {
    throw new Error('Approval does not match the public product name.');
  }
  if (approval.rightsConfirmed !== true) {
    throw new Error('Approval does not confirm publication rights.');
  }
  if (approval.validationStatus !== 'passed') {
    throw new Error('Approval does not confirm a passing validation status.');
  }
  requireStringArray(approval.knownLimitations, 'Known limitations', true);
  requireStringArray(approval.unresolvedIssues, 'Unresolved issues', true);
  const actual = normalizeInventory(artifacts);
  const approved = normalizeInventory(approval.artifacts);
  if (JSON.stringify(approved) !== JSON.stringify(actual)) {
    throw new Error('Approval does not match the complete artifact inventory.');
  }
}

export function validateContainerSmokeReport(container, gitSha) {
  return (
    container?.schemaVersion === 1 &&
    container.git?.sha === gitSha &&
    container.git?.clean === true &&
    typeof container.engine?.name === 'string' &&
    Boolean(container.engine.name.trim()) &&
    typeof container.engine?.version === 'string' &&
    Boolean(container.engine.version.trim()) &&
    container.engine?.platform === 'linux/arm64' &&
    typeof container.image?.reference === 'string' &&
    Boolean(container.image.reference.trim()) &&
    /^sha256:[a-f0-9]{64}$/.test(container.image?.digest ?? '') &&
    container.image?.revision === gitSha &&
    typeof container.resources?.containerName === 'string' &&
    Boolean(container.resources.containerName.trim()) &&
    validUniqueStrings(container.resources?.volumeNames, true) &&
    container.checks?.health === true &&
    ['ok', 'degraded'].includes(container.checks?.healthStatus) &&
    container.checks?.pendingFileCleanup === 0 &&
    container.checks?.invalidHostStatus === 421 &&
    container.checks?.runtimeUid === 1000 &&
    container.checks?.runtimePid === 1 &&
    container.checks?.persistenceAfterRestart === true &&
    container.checks?.gracefulSigterm === true &&
    container.checks?.shutdownSignal === 'SIGTERM' &&
    Number.isFinite(container.checks?.stopMilliseconds) &&
    container.checks.stopMilliseconds >= 0 &&
    container.checks.stopMilliseconds <= 10_000 &&
    /^[a-f0-9]{64}$/.test(container.checks?.shutdownLogSha256 ?? '') &&
    container.checks?.cleanupComplete === true
  );
}

export function containsUnsupportedQualifier(value) {
  return /\b(?:consistent|significant|critical|severe|urgent|always|guarantee|mandatory|revenue)\b/i.test(
    value,
  );
}

export function containsInventedExample(value) {
  return /(?:\be\.g\.|\b(?:for example|for instance|such as)\b)/i.test(value);
}

export function parseContainerSystemStatus(stdout) {
  const parsed = stdout.trim() ? JSON.parse(stdout) : null;
  if (typeof parsed?.status !== 'string') {
    throw new Error('Apple Container returned an unreadable service status.');
  }
  return parsed.status;
}

function hasExactPassedSteps(results) {
  if (!Array.isArray(results) || results.length !== requiredOfflineSteps.length) return false;
  const byName = new Map(results.map((result) => [result?.name, result]));
  if (byName.size !== requiredOfflineSteps.length) return false;
  return requiredOfflineSteps.every((name) => {
    const result = byName.get(name);
    return result?.status === 'passed' && result?.exitCode === 0;
  });
}

function validModelEvidence(model, gitSha) {
  if (
    model.gitSha !== gitSha ||
    model.dirtyWorkingTree !== false ||
    typeof model.model !== 'string' ||
    !model.model.trim() ||
    !/^[a-f0-9]{64}$/.test(model.modelDigest ?? '') ||
    typeof model.reviewModel !== 'string' ||
    !model.reviewModel.trim() ||
    !/^[a-f0-9]{64}$/.test(model.reviewModelDigest ?? '') ||
    model.provider !== 'ollama' ||
    model.retrievalMode !== 'lexical' ||
    model.corpusVersion !== 2 ||
    !hasExactModelScenarios(model.scenarios) ||
    !hasExactTrueChecks(model.structuredReview?.checks, requiredStructuredReviewChecks) ||
    !scoreMatches(model.structuredReview?.score, model.structuredReview?.checks) ||
    !hasExactTrueChecks(model.persistence, requiredPersistenceChecks) ||
    !validUniqueStrings(model.limitations, true)
  ) {
    return false;
  }
  const checks = [
    ...model.scenarios.flatMap((scenario) => Object.values(scenario.checks)),
    ...Object.values(model.structuredReview.checks),
    ...Object.values(model.persistence),
  ];
  return (
    model.score?.passed === checks.length &&
    model.score?.total === checks.length &&
    model.score?.percentage === 100
  );
}

function hasExactModelScenarios(scenarios) {
  const expected = Object.entries(requiredModelScenarioChecks);
  if (!Array.isArray(scenarios) || scenarios.length !== expected.length) return false;
  const byId = new Map(scenarios.map((scenario) => [scenario?.id, scenario]));
  if (byId.size !== expected.length) return false;
  return expected.every(([id, checks]) => {
    const scenario = byId.get(id);
    return (
      hasExactTrueChecks(scenario?.checks, checks) &&
      scoreMatches(scenario?.score, scenario?.checks)
    );
  });
}

function hasExactTrueChecks(value, expectedNames) {
  if (!value || typeof value !== 'object') return false;
  const names = Object.keys(value);
  return (
    names.length === expectedNames.length &&
    new Set(names).size === expectedNames.length &&
    expectedNames.every((name) => value[name] === true)
  );
}

function scoreMatches(score, checks) {
  const values = checks && typeof checks === 'object' ? Object.values(checks) : [];
  return (
    values.length > 0 &&
    score?.passed === values.length &&
    score?.total === values.length &&
    score?.percentage === 100
  );
}

function requireStringArray(value, label, requireNonEmpty) {
  if (!validUniqueStrings(value, requireNonEmpty)) {
    throw new Error(`${label} must be ${requireNonEmpty ? 'a non-empty' : 'an'} array of strings.`);
  }
}

function validUniqueStrings(value, requireNonEmpty) {
  if (
    !Array.isArray(value) ||
    (requireNonEmpty && value.length === 0) ||
    value.some((item) => typeof item !== 'string' || !item.trim())
  ) {
    return false;
  }
  return new Set(value.map((item) => item.trim())).size === value.length;
}

function normalizeInventory(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Artifact inventory is missing.');
  }
  const normalized = value.map((record) => {
    if (
      typeof record?.path !== 'string' ||
      !record.path ||
      path.isAbsolute(record.path) ||
      record.path.includes('\\') ||
      record.path.split('/').some((part) => part === '..' || part === '') ||
      typeof record?.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(record.sha256)
    ) {
      throw new Error('Artifact inventory contains an invalid record.');
    }
    return { path: record.path, sha256: record.sha256 };
  });
  const paths = new Set(normalized.map((record) => record.path));
  if (paths.size !== normalized.length) throw new Error('Artifact inventory contains duplicates.');
  return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

function requireRegularFile(root, relative) {
  const stat = fs.lstatSync(path.join(root, relative), { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new Error(`Required artifact is missing: ${relative}`);
}

function walk(root, directory, collected) {
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (entry.isSymbolicLink())
      throw new Error(`Artifact tree contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) walk(root, absolute, collected);
    else if (entry.isFile()) collected.push(relative);
  }
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}
