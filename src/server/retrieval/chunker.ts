export interface ChunkInput {
  locationId: string;
  content: string;
  documentHash: string;
  startOffset?: number;
}

export interface TextChunk {
  id: string;
  locationId: string;
  ordinal: number;
  content: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  documentHash: string;
}

export interface ChunkOptions {
  maxTokens: number;
  overlapTokens: number;
}

const DEFAULT_OPTIONS: ChunkOptions = {
  maxTokens: 220,
  overlapTokens: 40,
};

export function estimateTokens(text: string): number {
  const words = text.trim().match(/\S+/g)?.length ?? 0;
  return Math.ceil(words * 1.3);
}

function units(text: string): Array<{ text: string; start: number; end: number }> {
  const result: Array<{ text: string; start: number; end: number }> = [];
  const boundary = /.+?(?:\n{2,}|(?<=[.!?])(?:\s+|$)|$)/gs;
  for (const match of text.matchAll(boundary)) {
    const value = match[0].trim();
    if (!value) continue;
    const local = match.index ?? 0;
    const leading = match[0].indexOf(value);
    result.push({
      text: value,
      start: local + Math.max(leading, 0),
      end: local + Math.max(leading, 0) + value.length,
    });
  }
  return result;
}

function splitLongUnit(
  unit: { text: string; start: number; end: number },
  maxTokens: number,
): Array<{ text: string; start: number; end: number }> {
  if (estimateTokens(unit.text) <= maxTokens) return [unit];
  const words = [...unit.text.matchAll(/\S+/g)];
  const maxWords = Math.max(1, Math.floor(maxTokens / 1.3));
  const parts: Array<{ text: string; start: number; end: number }> = [];
  for (let offset = 0; offset < words.length; offset += maxWords) {
    const group = words.slice(offset, offset + maxWords);
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last || first.index === undefined || last.index === undefined) continue;
    const start = unit.start + first.index;
    const end = unit.start + last.index + last[0].length;
    parts.push({ text: unit.text.slice(first.index, last.index + last[0].length), start, end });
  }
  return parts;
}

export function chunkText(input: ChunkInput, options: ChunkOptions = DEFAULT_OPTIONS): TextChunk[] {
  if (options.maxTokens <= 0) throw new Error('maxTokens must be positive.');
  if (options.overlapTokens < 0 || options.overlapTokens >= options.maxTokens) {
    throw new Error('overlapTokens must be nonnegative and smaller than maxTokens.');
  }

  const baseOffset = input.startOffset ?? 0;
  const sourceUnits = units(input.content).flatMap((unit) =>
    splitLongUnit(unit, options.maxTokens),
  );
  const chunks: TextChunk[] = [];
  let cursor = 0;

  while (cursor < sourceUnits.length) {
    const selected: typeof sourceUnits = [];
    let tokens = 0;
    let next = cursor;
    while (next < sourceUnits.length) {
      const candidate = sourceUnits[next];
      if (!candidate) break;
      const candidateTokens = estimateTokens(candidate.text);
      if (selected.length > 0 && tokens + candidateTokens > options.maxTokens) break;
      selected.push(candidate);
      tokens += candidateTokens;
      next += 1;
    }

    const first = selected[0];
    const last = selected.at(-1);
    if (!first || !last) break;
    const content = input.content.slice(first.start, last.end).trim();
    const ordinal = chunks.length;
    chunks.push({
      id: crypto.randomUUID(),
      locationId: input.locationId,
      ordinal,
      content,
      tokenCount: estimateTokens(content),
      startOffset: baseOffset + first.start,
      endOffset: baseOffset + last.end,
      documentHash: input.documentHash,
    });

    if (next >= sourceUnits.length) break;
    let overlap = 0;
    let rewind = next;
    while (rewind > cursor + 1 && overlap < options.overlapTokens) {
      rewind -= 1;
      const previous = sourceUnits[rewind];
      if (previous) overlap += estimateTokens(previous.text);
    }
    cursor = Math.max(cursor + 1, rewind);
  }

  return chunks;
}
