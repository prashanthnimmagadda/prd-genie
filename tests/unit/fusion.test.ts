import { describe, expect, it } from 'vitest';
import { cosineSimilarity, reciprocalRankFusion } from '../../src/server/retrieval/fusion.js';

describe('reciprocalRankFusion', () => {
  it('rewards candidates present in both rankings', () => {
    const result = reciprocalRankFusion([
      [
        { id: 'a', sourceId: 'one' },
        { id: 'b', sourceId: 'two' },
      ],
      [
        { id: 'b', sourceId: 'two' },
        { id: 'c', sourceId: 'three' },
      ],
    ]);
    expect(result[0]?.id).toBe('b');
  });

  it('limits repeated excerpts from one source', () => {
    const result = reciprocalRankFusion(
      [
        Array.from({ length: 10 }, (_, index) => ({
          id: `same-${index}`,
          sourceId: 'same',
        })),
        [{ id: 'different', sourceId: 'different' }],
      ],
      { limit: 8, sourceLimit: 2 },
    );
    expect(result.filter((item) => item.sourceId === 'same')).toHaveLength(2);
    expect(result.some((item) => item.id === 'different')).toBe(true);
  });
});

describe('cosineSimilarity', () => {
  it('compares equal, opposite, and invalid vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(-1);
    expect(cosineSimilarity([1], [1, 2])).toBe(-1);
  });
});
