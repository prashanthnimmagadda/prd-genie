import { beforeEach, describe, expect, it, vi } from 'vitest';

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('ai', () => ({
  Output: { object: ({ schema }: { schema: unknown }) => schema },
  generateText: aiMocks.generateText,
  streamText: aiMocks.streamText,
  createUIMessageStream: ({
    execute,
    onError,
  }: {
    execute: (value: { writer: { write: (value: unknown) => void; merge: () => void } }) => unknown;
    onError: (error: unknown) => string;
  }) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const writer = {
          write: (value: unknown) =>
            controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)),
          merge: () => undefined,
        };
        Promise.resolve(execute({ writer }))
          .catch((error: unknown) => {
            controller.enqueue(encoder.encode(onError(error)));
          })
          .finally(() => controller.close());
      },
    }),
  createUIMessageStreamResponse: ({ stream }: { stream: ReadableStream<Uint8Array> }) =>
    new Response(stream),
}));

import { ActionService } from '../../src/server/providers/action-service.js';
import type { Repository } from '../../src/server/db/repository.js';
import type { RetrievalService } from '../../src/server/retrieval/retrieval-service.js';
import type { ProviderService } from '../../src/server/providers/provider-service.js';
import type { AiActionRequest, Citation, PrdDocument } from '../../src/shared/types.js';

const sectionId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const prd: PrdDocument = {
  projectId,
  revision: 2,
  sections: [
    {
      id: sectionId,
      projectId,
      title: 'Problem',
      body: 'People lose unsaved drafts.',
      position: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};
const evidence: Citation = {
  id: 'citation-display',
  sourceId: 'source-id',
  sourceName: 'research.txt',
  locationId: 'location-id',
  locator: 'Paragraph 1',
  chunkId: 'chunk-id',
  excerpt: 'Five participants lost unsaved drafts.',
  evidenceStatus: 'supported',
  available: true,
  unavailabilityReason: null,
};

function request(overrides: Partial<AiActionRequest> = {}): AiActionRequest {
  return {
    projectId,
    revision: 2,
    action: 'draft',
    scope: 'section',
    provider: 'ollama',
    model: 'synthetic',
    targetSectionId: sectionId,
    instruction: 'Improve this section.',
    ...overrides,
  };
}

describe('ActionService', () => {
  const repository = {
    getPrd: vi.fn(() => prd),
    createAiRun: vi.fn(() => 'run-id'),
    storeCitation: vi.fn(() => 'stored-citation'),
    storeFinding: vi.fn((input: Record<string, unknown>) => ({
      id: 'finding-id',
      status: 'open',
      citations: [],
      ...input,
    })),
    completeAiRun: vi.fn(),
  };
  const retrieval = { retrieve: vi.fn(() => Promise.resolve([evidence])) };
  const providers = { model: vi.fn(() => ({ provider: 'synthetic' })) };
  const service = new ActionService(
    repository as unknown as Repository,
    retrieval as unknown as RetrievalService,
    providers as unknown as ProviderService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    repository.getPrd.mockReturnValue(prd);
    retrieval.retrieve.mockResolvedValue([evidence]);
    repository.createAiRun.mockReturnValue('run-id');
    repository.storeCitation.mockReturnValue('stored-citation');
    aiMocks.generateText.mockResolvedValue({ text: 'Draft result' });
    aiMocks.streamText.mockReturnValue({
      toUIMessageStream: () => new ReadableStream({ start: (controller) => controller.close() }),
      text: Promise.resolve('Draft result'),
    });
  });

  it('rejects stale revisions and invalid selection or section scopes', async () => {
    await expect(
      service.run(undefined, request({ revision: 1 }), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    await expect(
      service.run(
        undefined,
        request({ scope: 'selection', selection: ' ' }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'missing_selection' });
    await expect(
      service.run(
        undefined,
        request({ scope: 'selection', selection: 'not present' }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'missing_selection' });
    await expect(
      service.run(
        undefined,
        request({ scope: 'section', targetSectionId: crypto.randomUUID() }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'missing_section' });
  });

  it('streams a scoped draft, stores evidence, and completes the run', async () => {
    const response = await service.run('session', request(), new AbortController().signal);
    const body = await response.text();
    expect(body).toContain('data-citation');
    expect(retrieval.retrieve).toHaveBeenCalledWith(
      projectId,
      expect.stringContaining('People lose unsaved drafts.'),
    );
    expect(repository.storeCitation).toHaveBeenCalledWith(
      expect.objectContaining({ chunkId: evidence.chunkId }),
    );
    const generationInput = aiMocks.generateText.mock.calls[0]?.[0] as
      | {
          maxOutputTokens: number;
          prompt: string;
          providerOptions?: { ollama?: { reasoningEffort?: string; think?: boolean } };
          temperature?: number;
        }
      | undefined;
    expect(generationInput?.maxOutputTokens).toBe(1800);
    expect(generationInput?.prompt).toContain('Retrieved source excerpts');
    expect(generationInput?.providerOptions?.ollama?.reasoningEffort).toBe('none');
    expect(generationInput?.providerOptions?.ollama?.think).toBe(false);
    expect(generationInput?.temperature).toBe(0);
    expect(repository.completeAiRun).toHaveBeenCalledWith('run-id', undefined, 'Draft result');
  });

  it('discloses only section metadata required by the selected scope', async () => {
    const confidentialId = '33333333-3333-4333-8333-333333333333';
    repository.getPrd.mockReturnValue({
      ...prd,
      sections: [
        ...prd.sections,
        {
          ...prd.sections[0]!,
          id: confidentialId,
          title: 'Confidential acquisition plan',
          body: 'Private content that is outside the selected scope.',
          position: 1,
        },
      ],
    });
    const scoped = await service.run('session', request(), new AbortController().signal);
    await scoped.text();
    const scopedPrompt = (aiMocks.generateText.mock.calls[0]?.[0] as { prompt: string }).prompt;
    expect(scopedPrompt).toContain(`${sectionId}: Problem`);
    expect(scopedPrompt).not.toContain(confidentialId);
    expect(scopedPrompt).not.toContain('Confidential acquisition plan');
    expect(scopedPrompt).not.toContain('Private content that is outside the selected scope.');

    const document = await service.run(
      'session',
      request({ scope: 'document', targetSectionId: undefined }),
      new AbortController().signal,
    );
    await document.text();
    const documentPrompt = (aiMocks.generateText.mock.calls[1]?.[0] as { prompt: string }).prompt;
    expect(documentPrompt).toContain(confidentialId);
    expect(documentPrompt).toContain('Confidential acquisition plan');
  });

  it.each([
    ['Context', 'relevant background'],
    ['Target users', 'affected users'],
    ['Goals', 'desired outcomes'],
    ['Non-goals', 'deliberately excluded'],
    ['Scope', 'release includes'],
    ['Success measures', 'outcome metrics'],
    ['Rollout', 'release stages'],
    ['Custom decision', 'directly belongs'],
  ])('adds section-specific boundary guidance for %s', async (title, guidance) => {
    repository.getPrd.mockReturnValue({
      ...prd,
      sections: [{ ...prd.sections[0]!, title }],
    });
    const response = await service.run('session', request(), new AbortController().signal);
    await response.text();
    const generationInput = aiMocks.generateText.mock.calls[0]?.[0] as
      { prompt?: string } | undefined;
    expect(generationInput?.prompt).toContain(guidance);
  });

  it.each([
    [{ action: 'ask', scope: 'document' }, 2400],
    [{ action: 'rewrite', scope: 'document' }, 6000],
    [{ action: 'ask', scope: 'selection', selection: 'unsaved drafts' }, 1200],
    [{ action: 'rewrite', scope: 'selection', selection: 'unsaved drafts' }, 1000],
  ] as const)('uses the action context budget for %o', async (overrides, expected) => {
    const response = await service.run(
      'session',
      request({
        ...overrides,
        targetSectionId: overrides.scope === 'document' ? undefined : sectionId,
        instruction: undefined,
        provider: overrides.scope === 'document' ? 'openai-compatible' : 'ollama',
      }),
      new AbortController().signal,
    );
    await response.text();
    const modelInput = (
      overrides.action === 'ask'
        ? aiMocks.streamText.mock.calls[0]?.[0]
        : aiMocks.generateText.mock.calls[0]?.[0]
    ) as { maxOutputTokens?: number; prompt?: string; providerOptions?: unknown } | undefined;
    expect(modelInput?.maxOutputTokens).toBe(expected);
    expect(modelInput?.prompt).toContain('(none)');
    if (overrides.scope === 'document') expect(modelInput?.providerOptions).toBeUndefined();
  });

  it('reviews the complete document and emits only findings for known sections', async () => {
    aiMocks.generateText.mockResolvedValue({
      output: {
        summary: 'One evidence gap found.',
        findings: {
          finding1: {
            category: 'evidence',
            severity: 'warning',
            targetSectionId: sectionId,
            rationale: 'Tie the statement to the interview.',
            citationChunkIds: ['chunk-id', 'unknown'],
            proposedMarkdown: 'Five participants lost unsaved drafts.',
          },
          finding2: {
            category: 'clarity',
            severity: 'info',
            targetSectionId: 'unknown-section',
            rationale: 'Skipped.',
            citationChunkIds: [],
            proposedMarkdown: null,
          },
          finding3: null,
          finding4: null,
          finding5: null,
        },
      },
    });
    const response = await service.run(
      'session',
      request({ action: 'review', scope: 'document', targetSectionId: undefined }),
      new AbortController().signal,
    );
    const body = await response.text();
    expect(body).toContain('One evidence gap found.');
    expect(repository.storeFinding).toHaveBeenCalledTimes(1);
    const storedFinding = repository.storeFinding.mock.calls[0]?.[0] as
      { citationIds: string[]; proposedPatch: { sectionId: string } } | undefined;
    expect(storedFinding?.citationIds).toEqual(['stored-citation']);
    expect(storedFinding?.proposedPatch.sectionId).toBe(sectionId);
    expect(repository.completeAiRun).toHaveBeenCalledWith(
      'run-id',
      undefined,
      'One evidence gap found.',
    );
  });

  it('streams the repository evidence state when a review completes after deletion', async () => {
    aiMocks.generateText.mockResolvedValue({
      output: {
        summary: 'The evidence was removed while the review was running.',
        findings: {
          finding1: {
            category: 'evidence',
            severity: 'warning',
            targetSectionId: sectionId,
            rationale: 'The cited evidence is no longer locally available.',
            citationChunkIds: ['chunk-id'],
            proposedMarkdown: null,
          },
          finding2: null,
          finding3: null,
          finding4: null,
          finding5: null,
        },
      },
    });
    repository.storeFinding.mockReturnValueOnce({
      id: 'finding-id',
      category: 'evidence',
      severity: 'warning',
      targetSectionId: sectionId,
      rationale: 'The cited evidence is no longer locally available.',
      citations: [{ ...evidence, available: false, unavailabilityReason: 'source_deleted' }],
      proposedPatch: null,
      sourceRevision: 2,
      status: 'stale',
    } as never);
    const response = await service.run(
      'session',
      request({ action: 'review', scope: 'document', targetSectionId: undefined }),
      new AbortController().signal,
    );
    const body = await response.text();
    expect(body).toContain('"status":"stale"');
    expect(body).toContain('"available":false');
    expect(body).toContain('"unavailabilityReason":"source_deleted"');
  });

  it('resolves a unique section title and supports findings without patches', async () => {
    aiMocks.generateText.mockResolvedValue({
      output: {
        summary: 'The Problem section needs evidence.',
        findings: {
          finding1: {
            category: 'evidence',
            severity: 'warning',
            targetSectionId: 'Problem',
            rationale: 'The claim has no cited support.',
            citationChunkIds: ['unknown'],
            proposedMarkdown: null,
          },
          finding2: null,
          finding3: null,
          finding4: null,
          finding5: null,
        },
      },
    });
    const response = await service.run(
      'session',
      request({ action: 'review', scope: 'document', targetSectionId: undefined }),
      new AbortController().signal,
    );
    await response.text();
    expect(repository.storeFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        targetSectionId: sectionId,
        citationIds: [],
        proposedPatch: null,
      }),
    );
  });

  it('rejects structured reviews that exceed the post-validation contract', async () => {
    aiMocks.generateText.mockResolvedValue({
      output: {
        summary: '',
        findings: {
          finding1: null,
          finding2: null,
          finding3: null,
          finding4: null,
          finding5: null,
        },
      },
    });
    const response = await service.run(
      'session',
      request({ action: 'review', scope: 'document', targetSectionId: undefined }),
      new AbortController().signal,
    );
    expect(await response.text()).toContain('malformed_output');
    expect(repository.completeAiRun).toHaveBeenCalledWith('run-id', 'malformed_output');
  });

  it('normalises provider failures and records a failed run', async () => {
    aiMocks.generateText.mockRejectedValue(Object.assign(new Error('rate limit'), { status: 429 }));
    const response = await service.run(
      'session',
      request({
        action: 'rewrite',
        scope: 'selection',
        selection: 'unsaved drafts',
      }),
      new AbortController().signal,
    );
    expect(await response.text()).toContain('rate_limit');
    expect(repository.completeAiRun).toHaveBeenCalledWith('run-id', 'rate_limit');
  });
});
