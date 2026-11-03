import type { ActionScope, AiAction, PrdDocument, SourceSummary } from '@shared/types';

export function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation could not be completed.';
}

export function formatTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(date)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDayTime(value: string): string {
  const day = formatDay(value);
  const time = formatTime(value);
  if (!day) return '';
  return day === 'Today' || day === 'Yesterday' ? `${day} at ${time}` : `${day}, ${time}`;
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export type FileKind = 'text' | 'markdown' | 'pdf' | 'word' | 'slides' | 'sheet' | 'image' | 'file';

export function fileKind(name: string, mediaType = ''): { kind: FileKind; label: string } {
  const extension = name.toLowerCase().split('.').pop() ?? '';
  if (extension === 'pdf' || mediaType === 'application/pdf') return { kind: 'pdf', label: 'PDF' };
  if (extension === 'docx' || mediaType.includes('wordprocessingml'))
    return { kind: 'word', label: 'Word' };
  if (extension === 'pptx' || mediaType.includes('presentationml'))
    return { kind: 'slides', label: 'PowerPoint' };
  if (extension === 'xlsx' || mediaType.includes('spreadsheetml'))
    return { kind: 'sheet', label: 'Excel' };
  if (['jpg', 'jpeg'].includes(extension) || mediaType.startsWith('image/'))
    return { kind: 'image', label: 'JPEG' };
  if (['md', 'markdown'].includes(extension)) return { kind: 'markdown', label: 'Markdown' };
  if (extension === 'txt' || mediaType.startsWith('text/')) return { kind: 'text', label: 'Text' };
  return { kind: 'file', label: extension ? extension.toUpperCase() : 'File' };
}

export function sectionNumber(index: number): string {
  return String(index + 1).padStart(2, '0');
}

export function countsSource(source: SourceSummary): boolean {
  return ['processing', 'ready', 'partial', 'failed'].includes(source.status);
}

export function truncateText(value: string, limit = 160): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

export function actionForInstruction(
  instruction: string,
  document: PrdDocument,
  scope: ActionScope = 'document',
): AiAction {
  const text = instruction.trim().toLowerCase();
  if (/^(what|why|how|which|where|when|who|is|are|does|can you explain|explain|list)\b/.test(text))
    return 'ask';
  if (/^(draft|create|write|start|generate)\b/.test(text)) return 'draft';
  if (/\b(review|critique|audit|assess|find gaps|check for)\b/.test(text)) return 'review';
  if (
    /\b(rewrite|revise|update|change|improve|replace|add|remove|make|tighten|summari[sz]e|condense|shorten|expand|clarify|rephrase|restate|simplify|state|describe|turn|convert|split|merge|reorder|fix)\b/.test(
      text,
    )
  )
    return 'rewrite';
  // An instruction aimed at a section or selection is a change request; only a
  // whole-document instruction that names no change is treated as a question.
  if (scope !== 'document') return 'rewrite';
  return document.sections.some((section) => section.body.trim()) ? 'ask' : 'draft';
}

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

/** Line diff (LCS). Large inputs fall back to a whole-block replacement. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.trim() ? before.trimEnd().split('\n') : [];
  const b = after.trim() ? after.trimEnd().split('\n') : [];
  if (a.length * b.length > 40_000) {
    return [
      ...a.map((text): DiffLine => ({ type: 'del', text })),
      ...b.map((text): DiffLine => ({ type: 'add', text })),
    ];
  }
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ type: 'same', text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ type: 'del', text: a[i]! });
      i++;
    } else {
      lines.push({ type: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < a.length) lines.push({ type: 'del', text: a[i++]! });
  while (j < b.length) lines.push({ type: 'add', text: b[j++]! });
  return lines;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function projectNameFromInstruction(instruction: string): string {
  const firstLine = instruction
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return 'Untitled project';
  const compact = firstLine.replace(/[#*_`>]/g, '').trim();
  if (!compact) return 'Untitled project';
  return compact.length <= 60 ? compact : `${compact.slice(0, 59).trimEnd()}…`;
}

export function revisionLabel(reason: string): string {
  if (/^project created/i.test(reason)) return 'Created';
  if (/example prd added/i.test(reason)) return 'Created from the example';
  if (/^ai run .* accepted/i.test(reason)) return 'Accepted change';
  if (/^review finding .* accepted/i.test(reason)) return 'Accepted change';
  if (/^manual edit|^saved before/i.test(reason)) return 'You edited the PRD';
  if (/handoff/i.test(reason)) return 'Imported handoff response';
  if (/restored? revision (\d+)/i.test(reason))
    return `Restored Version ${/revision (\d+)/i.exec(reason)?.[1] ?? ''}`.trim();
  if (/structure/i.test(reason)) return reason.replace(/revision/gi, 'Version');
  return reason;
}
