export function historicalExceptionBlob(
  commit: string,
  relative: string,
  finding: string,
): string | undefined;

export function matchesHistoricalException(
  commit: string,
  relative: string,
  finding: string,
  actualBlob: string,
): boolean;
