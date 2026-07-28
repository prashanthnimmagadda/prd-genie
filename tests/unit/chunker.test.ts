import { describe, expect, it } from 'vitest';
import { chunkText, estimateTokens } from '../../src/server/retrieval/chunker.js';

describe('chunkText', () => {
  it('keeps chunks under the configured token cap', () => {
    const content = Array.from(
      { length: 20 },
      (_, index) => `Sentence ${index + 1} contains a concrete product decision.`,
    ).join(' ');
    const chunks = chunkText(
      { locationId: 'location', content, documentHash: 'hash' },
      { maxTokens: 30, overlapTokens: 5 },
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.tokenCount <= 30)).toBe(true);
    expect(chunks.every((chunk) => chunk.documentHash === 'hash')).toBe(true);
  });

  it('splits a single long unit without losing ordering', () => {
    const content = Array.from({ length: 100 }, (_, index) => `word${index}`).join(' ');
    const chunks = chunkText(
      { locationId: 'location', content, documentHash: 'hash', startOffset: 10 },
      { maxTokens: 20, overlapTokens: 4 },
    );
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks[0]?.startOffset).toBe(10);
    expect(chunks.at(-1)?.endOffset).toBe(10 + content.length);
  });

  it('validates overlap settings', () => {
    expect(() =>
      chunkText(
        { locationId: 'location', content: 'text', documentHash: 'hash' },
        { maxTokens: 10, overlapTokens: 10 },
      ),
    ).toThrow('overlapTokens');
    expect(() =>
      chunkText(
        { locationId: 'location', content: 'text', documentHash: 'hash' },
        { maxTokens: 0, overlapTokens: 0 },
      ),
    ).toThrow('maxTokens');
    expect(() =>
      chunkText(
        { locationId: 'location', content: 'text', documentHash: 'hash' },
        { maxTokens: 10, overlapTokens: -1 },
      ),
    ).toThrow('overlapTokens');
    expect(chunkText({ locationId: 'location', content: '   ', documentHash: 'hash' })).toEqual([]);
    expect(estimateTokens('one two three')).toBe(4);
    expect(estimateTokens('')).toBe(0);
  });
});
