import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderService } from '../../src/server/providers/provider-service.js';
import { SessionStore } from '../../src/server/providers/session-store.js';
import { createGuardedProviderFetch } from '../../src/server/providers/endpoints.js';

describe('ProviderService', () => {
  afterEach(() => vi.unstubAllGlobals());

  const testGuardedFetch = () =>
    createGuardedProviderFetch({
      resolveAddresses: () => Promise.resolve(['93.184.216.34']),
      fetch: (input, init) => globalThis.fetch(input, init),
    });

  function configured(provider: 'openai' | 'anthropic' | 'google' | 'openai-compatible') {
    const sessions = new SessionStore();
    const session = sessions.create();
    sessions.setProvider(session.id, provider, {
      apiKey: ['test', provider, 'value'].join('-'),
      ...(provider === 'openai-compatible' ? { baseUrl: 'https://models.example.com/v1' } : {}),
    });
    return {
      service: new ProviderService(sessions, testGuardedFetch()),
      sessionId: session.id,
    };
  }

  it('constructs direct provider models without making a request', () => {
    for (const provider of ['openai', 'anthropic', 'google', 'openai-compatible'] as const) {
      const { service, sessionId } = configured(provider);
      expect(service.model(sessionId, provider, 'synthetic-model')).toBeDefined();
    }
    expect(
      new ProviderService(new SessionStore()).model(undefined, 'ollama', 'local'),
    ).toBeDefined();
  });

  it('rejects missing credentials and endpoints', () => {
    const service = new ProviderService(new SessionStore(), testGuardedFetch());
    expect(() => service.model(undefined, 'openai', 'model')).toThrow('Configure');
    expect(() => service.model(undefined, 'openai-compatible', 'model')).toThrow('endpoint');
  });

  it('rejects model discovery without required credentials', async () => {
    await expect(
      new ProviderService(new SessionStore()).listModels(undefined, 'anthropic'),
    ).rejects.toMatchObject({ code: 'missing_credentials' });
  });

  it('supports keyless OpenAI-compatible endpoints', () => {
    const sessions = new SessionStore();
    const session = sessions.create();
    sessions.setProvider(session.id, 'openai-compatible', {
      baseUrl: 'http://127.0.0.1:1234/v1',
    });
    expect(
      new ProviderService(sessions).model(session.id, 'openai-compatible', 'local-model'),
    ).toBeDefined();
  });

  it.each([
    ['openai', { data: [{ id: 'gpt-test' }] }, 'gpt-test'],
    ['anthropic', { data: [{ id: 'claude-test', display_name: 'Claude Test' }] }, 'claude-test'],
    [
      'google',
      { models: [{ name: 'models/gemini-test', displayName: 'Gemini Test' }] },
      'gemini-test',
    ],
    ['openai-compatible', { data: [{ id: 'custom-test' }] }, 'custom-test'],
  ] as const)('discovers %s models', async (provider, payload, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    const { service, sessionId } = configured(provider);
    const models = await service.listModels(sessionId, provider);
    expect(models.some((model) => model.id === expected)).toBe(true);
  });

  it('discovers local Ollama tags and normalises HTTP failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ models: [{ name: 'llama-test' }] }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response('{}', { status: 429 })),
    );
    const service = new ProviderService(new SessionStore(), testGuardedFetch());
    expect(await service.listModels(undefined, 'ollama')).toEqual([
      { id: 'llama-test', name: 'llama-test' },
    ]);
    await expect(service.listModels(undefined, 'ollama')).rejects.toMatchObject({
      code: 'rate_limit',
    });
  });

  it('rejects malformed model lists and ignores malformed rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('null'))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [null, 'invalid', { id: 42 }, { id: 'valid', displayName: 'Valid model' }],
            }),
          ),
        ),
    );
    const { service, sessionId } = configured('openai-compatible');
    await expect(service.listModels(sessionId, 'openai-compatible')).rejects.toMatchObject({
      code: 'malformed_output',
    });
    expect(await service.listModels(sessionId, 'openai-compatible')).toEqual([
      { id: 'valid', name: 'Valid model' },
    ]);
  });

  it('normalises network rejection and supports compatible model-list variants', async () => {
    const { service, sessionId } = configured('openai-compatible');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')));
    await expect(
      service.listModels(sessionId, 'openai-compatible', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'network_failure' });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              models: [
                { name: 'z-compatible-model' },
                { id: 'a-compatible-model', displayName: 'A compatible model' },
              ],
            }),
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({}))),
    );
    expect(await service.listModels(sessionId, 'openai-compatible')).toEqual([
      { id: 'a-compatible-model', name: 'A compatible model' },
      { id: 'z-compatible-model', name: 'z-compatible-model' },
    ]);
    expect(await service.listModels(sessionId, 'openai-compatible')).toEqual([]);
  });

  it('discovers models from a keyless compatible endpoint', async () => {
    const sessions = new SessionStore();
    const session = sessions.create();
    sessions.setProvider(session.id, 'openai-compatible', {
      baseUrl: 'http://127.0.0.1:1234/v1',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'local' }] }))),
    );
    await expect(
      new ProviderService(sessions, testGuardedFetch()).listModels(session.id, 'openai-compatible'),
    ).resolves.toEqual([{ id: 'local', name: 'local' }]);
  });
});
