import { describe, expect, it } from 'vitest';
import type { PrdDocument } from '../../src/shared/types';
import { actionForInstruction } from '../../src/client/lib/format';

const filled = {
  projectId: 'p',
  revision: 1,
  sections: [{ id: 's', title: 'Context', body: 'Some text.', position: 0 }],
} as unknown as PrdDocument;
const empty = {
  ...filled,
  sections: [{ id: 's', title: 'Context', body: '', position: 0 }],
} as unknown as PrdDocument;

describe('instruction intent', () => {
  it('treats summarising a section as a change, not a question', () => {
    const instruction =
      'Summarize the context. State both observed rates and explain that they conflict.';
    expect(actionForInstruction(instruction, filled, 'section')).toBe('rewrite');
    expect(actionForInstruction(instruction, filled, 'document')).toBe('rewrite');
  });

  it('keeps questions as questions in any scope', () => {
    expect(actionForInstruction('What evidence supports this?', filled, 'section')).toBe('ask');
    expect(actionForInstruction('Does this cover rollback?', filled, 'document')).toBe('ask');
  });

  it('routes unclassified section instructions to a proposal', () => {
    expect(actionForInstruction('Only the validated participants', filled, 'section')).toBe(
      'rewrite',
    );
    expect(actionForInstruction('Only the validated participants', filled, 'document')).toBe('ask');
    expect(actionForInstruction('Only the validated participants', empty, 'document')).toBe(
      'draft',
    );
  });

  it('keeps draft and review routing', () => {
    expect(actionForInstruction('Draft the problem from my notes', empty, 'section')).toBe('draft');
    expect(actionForInstruction('Review the whole PRD for gaps', filled, 'document')).toBe(
      'review',
    );
  });
});
