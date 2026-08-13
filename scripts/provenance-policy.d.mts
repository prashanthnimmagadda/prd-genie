export interface ArtifactRecord {
  path: string;
  sha256: string;
}

export interface PublicApproval {
  schemaVersion: 1;
  approvalScope: 'public-github-release';
  approved: boolean;
  gitSha: string;
  tag: string;
  publicTarget: string;
  publicName: string;
  rightsConfirmed: boolean;
  validationStatus: 'passed';
  knownLimitations: string[];
  unresolvedIssues: string[];
  artifacts: ArtifactRecord[];
}

export const publicProductName: string;
export const publicReleaseTarget: string;
export const requiredOfflineSteps: string[];
export const requiredModelScenarioChecks: Record<string, string[]>;
export const requiredStructuredReviewChecks: string[];
export const requiredPersistenceChecks: string[];
export const requiredArtifactFiles: string[];
export const requiredArtifactDirectories: string[];
export function collectArtifactPaths(root: string): string[];
export function validateEvidenceReports(root: string, gitSha: string): void;
export function validatePublicApproval(input: {
  approval: unknown;
  artifacts: ArtifactRecord[];
  gitSha: string;
  clean: boolean;
  tagSha: string;
}): void;
export function validateContainerSmokeReport(report: unknown, gitSha: string): boolean;
export function containsUnsupportedQualifier(value: string): boolean;
export function containsInventedExample(value: string): boolean;
export function parseContainerSystemStatus(stdout: string): string;
