export interface RankedCandidate {
  id: string;
  sourceId: string;
  score?: number;
}

export interface FusedCandidate {
  id: string;
  sourceId: string;
  score: number;
}

export function reciprocalRankFusion(
  rankings: RankedCandidate[][],
  options: { k?: number; limit?: number; sourceLimit?: number } = {},
): FusedCandidate[] {
  const k = options.k ?? 60;
  const limit = options.limit ?? 8;
  const sourceLimit = options.sourceLimit ?? 3;
  const fused = new Map<string, FusedCandidate>();

  for (const ranking of rankings) {
    ranking.forEach((candidate, index) => {
      const current = fused.get(candidate.id) ?? {
        id: candidate.id,
        sourceId: candidate.sourceId,
        score: 0,
      };
      current.score += 1 / (k + index + 1);
      fused.set(candidate.id, current);
    });
  }

  const sorted = [...fused.values()].sort(
    (left, right) => right.score - left.score || left.id.localeCompare(right.id),
  );
  const counts = new Map<string, number>();
  const diverse: FusedCandidate[] = [];
  for (const candidate of sorted) {
    const count = counts.get(candidate.sourceId) ?? 0;
    if (count >= sourceLimit) continue;
    counts.set(candidate.sourceId, count + 1);
    diverse.push(candidate);
    if (diverse.length === limit) break;
  }
  return diverse;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return -1;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return -1;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}
