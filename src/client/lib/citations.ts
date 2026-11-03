import type { Citation } from '@shared/types';

// Generated text cites evidence with exact chunk IDs, for example
// "[0b1c...]" or "[id-a, id-b]". The markers stay in stored text so provenance
// can be revalidated; the interface shows them as numbered citation chips.
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const markerPattern = new RegExp(`\\[(${uuid}(?:\\s*[,;]\\s*${uuid})*)\\]`, 'gi');

export type CitedPart = string | { marker: string; numbers: number[] };

export type CitationNumbers = Map<string, number>;

export function citationNumbers(citations: Pick<Citation, 'chunkId'>[]): CitationNumbers {
  const numbers: CitationNumbers = new Map();
  citations.forEach((citation, index) => {
    if (citation.chunkId && !numbers.has(citation.chunkId.toLowerCase()))
      numbers.set(citation.chunkId.toLowerCase(), index + 1);
  });
  return numbers;
}

/** Splits text into plain runs and citation markers. Unknown IDs are numbered after known ones. */
export function splitCitations(text: string, numbers: CitationNumbers = new Map()): CitedPart[] {
  const known = new Map(numbers);
  const parts: CitedPart[] = [];
  let last = 0;
  for (const match of text.matchAll(markerPattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    const ids = (match[1] ?? '').split(/[,;]/).map((id) => id.trim().toLowerCase());
    const assigned = ids.map((id) => {
      if (!known.has(id)) known.set(id, known.size + 1);
      return known.get(id)!;
    });
    parts.push({ marker: match[0], numbers: [...new Set(assigned)] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Plain-text rendering for Markdown surfaces: "[uuid]" becomes "[1]". */
export function numberCitationMarkers(text: string, numbers: CitationNumbers = new Map()): string {
  return splitCitations(text, numbers)
    .map((part) => (typeof part === 'string' ? part : `[${part.numbers.join(', ')}]`))
    .join('');
}

const escapedMarkerPattern = new RegExp(`\\\\\\[(${uuid}(?:\\s*[,;]\\s*${uuid})*)\\\\\\]`, 'gi');

/** The Markdown serializer escapes "[" and "]"; citation markers must stay exact. */
export function unescapeCitationMarkers(markdown: string): string {
  return markdown.replace(escapedMarkerPattern, '[$1]');
}
