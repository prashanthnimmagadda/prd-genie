export function citationClaimText(
  generated: string,
  allowedCitationChunkIds: readonly string[],
): { claimText: string; invalid: boolean };
export function hasLiteralClaimSupport(
  generated: string,
  trustedPassages: string[],
  allowedCitationChunkIds?: readonly string[],
  citationPassages?: Readonly<Record<string, string>>,
): boolean;

export function isInstructionLikeEvidence(value: string): boolean;

export function claimClauses(value: string): string[][];
