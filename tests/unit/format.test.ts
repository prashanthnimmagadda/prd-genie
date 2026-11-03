import { describe, expect, it } from 'vitest';
import type { SourceSummary } from '../../src/shared/types';
import {
  countsSource,
  fileKind,
  formatBytes,
  formatDay,
  formatDayTime,
  formatTime,
  lineDiff,
  messageFrom,
  pluralize,
  projectNameFromInstruction,
  revisionLabel,
  sectionNumber,
  truncateText,
} from '../../src/client/lib/format';

describe('client formatting helpers', () => {
  it('describes errors and invalid times safely', () => {
    expect(messageFrom(new Error('Disk full'))).toBe('Disk full');
    expect(messageFrom('nope')).toBe('The operation could not be completed.');
    expect(formatTime('not a date')).toBe('');
    expect(formatTime(new Date(2026, 10, 3, 9, 5))).toMatch(/09.05|9.05/);
    expect(formatDay('not a date')).toBe('');
    expect(formatDayTime('not a date')).toBe('');
  });

  it('names today, yesterday and older days', () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86_400_000);
    expect(formatDay(now.toISOString())).toBe('Today');
    expect(formatDay(yesterday.toISOString())).toBe('Yesterday');
    expect(formatDay('2024-02-01T12:00:00Z')).toMatch(/2024/);
    expect(formatDayTime(now.toISOString())).toMatch(/^Today at /);
    expect(formatDayTime('2024-02-01T12:00:00Z')).toMatch(/2024, /);
  });

  it('formats byte sizes', () => {
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1500)).toBe('1 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
  });

  it('labels file kinds by extension or media type', () => {
    expect(fileKind('a.pdf')).toEqual({ kind: 'pdf', label: 'PDF' });
    expect(fileKind('x', 'application/pdf').kind).toBe('pdf');
    expect(fileKind('a.docx').label).toBe('Word');
    expect(
      fileKind('x', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').kind,
    ).toBe('word');
    expect(fileKind('a.pptx').label).toBe('PowerPoint');
    expect(
      fileKind('x', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
        .kind,
    ).toBe('slides');
    expect(fileKind('a.xlsx').label).toBe('Excel');
    expect(
      fileKind('x', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').kind,
    ).toBe('sheet');
    expect(fileKind('a.JPG').kind).toBe('image');
    expect(fileKind('x', 'image/jpeg').kind).toBe('image');
    expect(fileKind('notes.markdown').kind).toBe('markdown');
    expect(fileKind('a.txt').kind).toBe('text');
    expect(fileKind('x', 'text/plain').kind).toBe('text');
    expect(fileKind('archive.zip')).toEqual({ kind: 'file', label: 'ZIP' });
    expect(fileKind('noextension')).toEqual({ kind: 'file', label: 'NOEXTENSION' });
  });

  it('formats numbers, counts, truncation and source states', () => {
    expect(sectionNumber(0)).toBe('01');
    expect(sectionNumber(12)).toBe('13');
    expect(pluralize(1, 'source')).toBe('1 source');
    expect(pluralize(2, 'source')).toBe('2 sources');
    expect(pluralize(2, 'entry', 'entries')).toBe('2 entries');
    expect(truncateText('a   b\n c')).toBe('a b c');
    expect(truncateText('abcdef', 4)).toBe('abc…');
    const source = (status: string) => ({ status }) as unknown as SourceSummary;
    expect(countsSource(source('ready'))).toBe(true);
    expect(countsSource(source('failed'))).toBe(true);
    expect(countsSource(source('deleted'))).toBe(false);
  });

  it('diffs lines, including large inputs', () => {
    expect(lineDiff('', '')).toEqual([]);
    expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'x' },
      { type: 'same', text: 'c' },
    ]);
    expect(lineDiff('a\nb', 'a')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
    ]);
    expect(lineDiff('a', 'a\nb').at(-1)).toEqual({ type: 'add', text: 'b' });
    expect(lineDiff('b', 'a\nb')[0]).toEqual({ type: 'add', text: 'a' });
    const many = (prefix: string) =>
      Array.from({ length: 250 }, (_, index) => `${prefix}${index}`).join('\n');
    const large = lineDiff(many('x'), many('y'));
    expect(large).toHaveLength(500);
    expect(large[0]!.type).toBe('del');
    expect(large.at(-1)!.type).toBe('add');
  });

  it('derives project names from the first meaningful line', () => {
    expect(projectNameFromInstruction('')).toBe('Untitled project');
    expect(projectNameFromInstruction('\n  \n')).toBe('Untitled project');
    expect(projectNameFromInstruction('### **\nmore')).toBe('Untitled project');
    expect(projectNameFromInstruction('\n# A scheduler\nnotes')).toBe('A scheduler');
    expect(projectNameFromInstruction('x'.repeat(80))).toBe(`${'x'.repeat(59)}…`);
  });

  it('labels revisions in plain language', () => {
    expect(revisionLabel('Project created')).toBe('Created');
    expect(revisionLabel('Example PRD added')).toBe('Created from the example');
    expect(revisionLabel('AI run 123 accepted')).toBe('Accepted change');
    expect(revisionLabel('Review finding 9 accepted')).toBe('Accepted change');
    expect(revisionLabel('Manual edit')).toBe('You edited the PRD');
    expect(revisionLabel('Saved before switching projects')).toBe('You edited the PRD');
    expect(revisionLabel('ChatGPT handoff applied')).toBe('Imported handoff response');
    expect(revisionLabel('Restored revision 4')).toBe('Restored Version 4');
    expect(revisionLabel('Structure changed at revision 2')).toBe('Structure changed at Version 2');
    expect(revisionLabel('Something else')).toBe('Something else');
  });
});
