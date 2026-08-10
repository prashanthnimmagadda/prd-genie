import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildFindingApplication,
  buildHandoffApplication,
} from '../../src/server/db/patch-application.js';
import type { ChatGptHandoffPatch, PrdSection } from '../../src/shared/types.js';

describe('revision patch application', () => {
  const firstId = '11111111-1111-4111-8111-111111111111';
  const secondId = '22222222-2222-4222-8222-222222222222';
  const sections: PrdSection[] = [
    {
      id: firstId,
      projectId: '33333333-3333-4333-8333-333333333333',
      title: 'Problem',
      body: 'Original problem.',
      position: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: secondId,
      projectId: '33333333-3333-4333-8333-333333333333',
      title: 'Context',
      body: 'Original context.',
      position: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const responsePatches: ChatGptHandoffPatch[] = [
    {
      sectionId: firstId,
      preimageHash: sha256('Original problem.'),
      afterMarkdown: 'Suggested problem.',
      evidenceIds: [],
    },
  ];

  it('applies only selected handoff patches', () => {
    const applied = buildHandoffApplication(sections, responsePatches, [
      { sectionId: firstId, afterMarkdown: 'User-revised problem.' },
    ]);
    expect(applied[0]?.body).toBe('User-revised problem.');
    expect(applied[1]?.body).toBe('Original context.');
  });

  it('rejects duplicate, unknown, missing, and stale handoff targets', () => {
    expect(() =>
      buildHandoffApplication(sections, responsePatches, [
        { sectionId: firstId, afterMarkdown: 'One' },
        { sectionId: firstId, afterMarkdown: 'Two' },
      ]),
    ).toThrow('invalid');
    expect(() =>
      buildHandoffApplication(sections, responsePatches, [
        { sectionId: secondId, afterMarkdown: 'Unknown patch' },
      ]),
    ).toThrow('invalid');
    expect(() =>
      buildHandoffApplication(sections.slice(1), responsePatches, [
        { sectionId: firstId, afterMarkdown: 'Missing target' },
      ]),
    ).toThrow('changed before acceptance');
    expect(() =>
      buildHandoffApplication(
        [{ ...sections[0]!, body: 'Changed problem.' }, sections[1]!],
        responsePatches,
        [{ sectionId: firstId, afterMarkdown: 'Stale target' }],
      ),
    ).toThrow('changed before acceptance');
  });

  it('applies exact and user-revised finding patches', () => {
    const patch = {
      sectionId: firstId,
      beforeMarkdown: 'Original problem.',
      afterMarkdown: 'Suggested problem.',
    };
    expect(buildFindingApplication(sections, patch)[0]?.body).toBe('Suggested problem.');
    expect(buildFindingApplication(sections, patch, 'User-revised problem.')[0]?.body).toBe(
      'User-revised problem.',
    );
    expect(buildFindingApplication(sections, patch)[1]?.body).toBe('Original context.');
  });

  it('rejects missing and stale finding targets', () => {
    expect(() =>
      buildFindingApplication(sections, {
        sectionId: crypto.randomUUID(),
        beforeMarkdown: '',
        afterMarkdown: 'Missing',
      }),
    ).toThrow('changed after this review');
    expect(() =>
      buildFindingApplication(sections, {
        sectionId: firstId,
        beforeMarkdown: 'Different preimage.',
        afterMarkdown: 'Stale',
      }),
    ).toThrow('changed after this review');
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
