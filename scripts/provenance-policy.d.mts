export interface ArtifactRecord {
  path: string;
  sha256: string;
}

export interface PublicProvenanceAuthorization {
  schemaVersion: 2;
  approvalScope: 'public-github-provenance-preparation';
  authorized: boolean;
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

export interface FinalPromotionApproval {
  schemaVersion: 2;
  approvalScope: 'public-github-promotion';
  approved: boolean;
  gitSha: string;
  tag: string;
  tagObjectSha: string;
  publicTarget: string;
  publicName: string;
  rightsConfirmed: boolean;
  validationStatus: 'passed';
  knownLimitations: string[];
  unresolvedIssues: string[];
  releaseAssets: ArtifactRecord[];
}

export const publicProductName: string;
export const publicReleaseTarget: string;
export const requiredOfflineSteps: string[];
export const requiredModelScenarioChecks: Record<string, string[]>;
export const requiredAdversarialStructuredReviewChecks: string[];
export const requiredStructuredReviewChecks: string[];
export const requiredPersistenceChecks: string[];
export const requiredBrowserProjects: string[];
export const requiredAccessibilityWidths: number[];
export const requiredAccessibilityChecks: string[];
export const requiredProductionSmokeChecks: string[];
export const requiredArtifactFiles: string[];
export const requiredArtifactDirectories: string[];
export function collectArtifactPaths(root: string): string[];
export function validateEvidenceReports(root: string, gitSha: string): void;
export function validatePublicProvenanceAuthorization(input: {
  authorization: unknown;
  artifacts: ArtifactRecord[];
  gitSha: string;
  clean: boolean;
  tagSha: string;
}): void;
export function validateFinalPromotionApproval(input: {
  approval: unknown;
  releaseAssets: ArtifactRecord[];
  gitSha: string;
  clean: boolean;
  tagSha: string;
  tagObjectSha: string;
}): void;
export function collectFinalReleaseAssets(input: {
  releaseDirectory: string;
  gitSha: string;
  tag: string;
}): ArtifactRecord[];
export function validateContainerSmokeReport(report: unknown, gitSha: string): boolean;
export function containsUnsupportedQualifier(value: string): boolean;
export function containsInventedExample(value: string): boolean;
export function parseContainerSystemStatus(stdout: string): string;
