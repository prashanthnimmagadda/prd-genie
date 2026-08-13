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
  'usesTwoOrThreeSummarySentences',
  'emitsFinding',
  'targetsKnownSections',
  'bindsRevision',
  'givesRationale',
  'bindsPatchTargets',
  'preservesPatchPreimages',
  'emitsAvailableGroundedCitation',
  'avoidsUnsupportedReviewQualifiers',
  'avoidsUnsupportedTargetRecommendations',
  'avoidsInventedExamples',
];
export const requiredPersistenceChecks = ['allProjectsPersisted', 'reviewHistoryPersisted'];

export const requiredArtifactFiles = [
  'Dockerfile',
  'docker-compose.yml',
  'package.json',
  'package-lock.json',
  'scripts/container-entrypoint.sh',
  'scripts/provenance.mjs',
  'scripts/provenance-policy.mjs',
  'scripts/record-container-smoke.mjs',
  'reports/container-smoke.json',
  'reports/licenses.json',
  'reports/model-evaluation.json',
  'reports/offline-ci.json',
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
  if (!validModelEvidence(model, gitSha)) {
    throw new Error('Model evaluation evidence does not validate the clean current SHA.');
  }
  if (!validateContainerSmokeReport(container, gitSha)) {
    throw new Error('Container smoke evidence does not validate the clean current SHA.');
  }
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
