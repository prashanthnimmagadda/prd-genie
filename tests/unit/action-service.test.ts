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
    const streamInput = aiMocks.streamText.mock.calls[0]?.[0] as
      { maxOutputTokens: number; prompt: string } | undefined;
    expect(streamInput?.maxOutputTokens).toBe(6000);
    expect(streamInput?.prompt).toContain('Retrieved source excerpts');
    expect(repository.completeAiRun).toHaveBeenCalledWith('run-id');
  });

  it('reviews the complete document and emits only findings for known sections', async () => {
    aiMocks.generateText.mockResolvedValue({
      output: {
        summary: 'One evidence gap found.',
        findings: [
          {
            category: 'evidence',
            severity: 'warning',
            targetSectionId: sectionId,
            rationale: 'Tie the statement to the interview.',
            citationChunkIds: ['chunk-id', 'unknown'],
            proposedMarkdown: 'Five participants lost unsaved drafts.',
          },
          {
            category: 'clarity',
            severity: 'info',
            targetSectionId: 'unknown-section',
            rationale: 'Skipped.',
            citationChunkIds: [],
            proposedMarkdown: null,
          },
        ],
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
    expect(repository.completeAiRun).toHaveBeenCalledWith('run-id');
  });

  it('normalises provider failures and records a failed run', async () => {
    aiMocks.streamText.mockReturnValue({
      toUIMessageStream: () => new ReadableStream({ start: (controller) => controller.close() }),
      text: Promise.reject(Object.assign(new Error('rate limit'), { status: 429 })),
    });
    const response = await service.run(
      'session',
      request({ action: 'rewrite', scope: 'selection', selection: 'selected words' }),
      new AbortController().signal,
    );
    expect(await response.text()).toContain('rate_limit');
    expect(repository.completeAiRun).toHaveBeenCalledWith('run-id', 'rate_limit');
  });
});
