import { describe, expect, it } from 'vitest';
import {
  citationNumbers,
  numberCitationMarkers,
  splitCitations,
  unescapeCitationMarkers,
} from '../../src/client/lib/citations';

const a = 'b9c407a7-a0a8-4356-9e08-c4d3e2debdab';
const b = '38f52da1-821d-469c-85b7-29d9402eb005';
const c = 'cb8880ad-aff4-4da0-be88-a4f8719e467a';

describe('citation markers', () => {
  it('numbers markers by the citation list and keeps the surrounding text', () => {
    const numbers = citationNumbers([{ chunkId: b }, { chunkId: a }, { chunkId: null }]);
    expect(splitCitations(`Eight lost work. [${a}] [${b}]`, numbers)).toEqual([
      'Eight lost work. ',
      { marker: `[${a}]`, numbers: [2] },
      ' ',
      { marker: `[${b}]`, numbers: [1] },
    ]);
  });

  it('handles grouped markers and numbers unknown IDs after known ones', () => {
    const numbers = citationNumbers([{ chunkId: a }]);
    expect(numberCitationMarkers(`One [${a}; ${c}]. Two [${c}].`, numbers)).toBe(
      'One [1, 2]. Two [2].',
    );
  });

  it('leaves ordinary Markdown brackets and malformed IDs alone', () => {
    const text = 'See [the spec](https://example.test) and [b9c407a7-a0a8] today.';
    expect(splitCitations(text)).toEqual([text]);
  });

  it('restores citation markers escaped by the Markdown serializer only', () => {
    expect(
      unescapeCitationMarkers(`Lost work. \\[${a}\\] and \\[${a}, ${b}\\] but \\[note\\]`),
    ).toBe(`Lost work. [${a}] and [${a}, ${b}] but \\[note\\]`);
  });
});
