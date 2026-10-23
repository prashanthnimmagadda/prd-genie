export const macosReportPath: string;
export const macosBundlePath: string;
export const macosChecks: string[];
export function macosZipName(version: string): string;
export function collectMacosArtifactPaths(root: string): string[];
export function validateMacosReleaseReport(report: unknown, expected: unknown): void;
export function validateMacosReleaseEvidence(
  root: string,
  gitSha: string,
  archiveOverride?: string,
): void;
export function validateMacosApplicationInputs(root: string): void;
export function inspectMacosArchive(
  archive: string,
  components: Array<{ path: string; sha256: string }>,
  inspect: (app: string) => void,
): void;
