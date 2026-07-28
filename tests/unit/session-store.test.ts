import { describe, expect, it, vi } from 'vitest';
import { SessionStore } from '../../src/server/providers/session-store.js';
import { config } from '../../src/server/config.js';

describe('SessionStore', () => {
  it('keeps keys in memory and returns only safe provider state', () => {
    const store = new SessionStore();
    const session = store.create();
    store.setProvider(session.id, 'openai-compatible', {
      apiKey: ['test', 'only', 'credential'].join('-'),
      baseUrl: 'https://models.example.com/v1',
      headers: { 'X-Private': 'redacted' },
    });
    expect(store.resolve(session.id, 'openai-compatible')).toMatchObject({
      baseUrl: 'https://models.example.com/v1',
    });
    expect(store.state(session.id, 'openai-compatible')).toEqual({
      provider: 'openai-compatible',
      credentialSource: 'session',
      configured: true,
      baseUrl: 'models.example.com',
    });
    expect(JSON.stringify(store.state(session.id, 'openai-compatible'))).not.toContain(
      'test-openai-compatible-value',
    );
    store.clearProvider(session.id, 'openai-compatible');
    expect(store.state(session.id, 'openai-compatible').credentialSource).toBe('none');
  });

  it('expires idle sessions and clears complete sessions', () => {
    vi.useFakeTimers();
    const store = new SessionStore();
    const session = store.create();
    vi.advanceTimersByTime(config.sessionIdleMs + 1);
    expect(store.get(session.id)).toBeUndefined();
    const second = store.create();
    store.clearSession(second.id);
    expect(store.get(second.id)).toBeUndefined();
    vi.useRealTimers();
  });

  it('provides the local Ollama default without a key', () => {
    const store = new SessionStore();
    expect(store.state(undefined, 'ollama')).toMatchObject({
      configured: true,
      baseUrl: '127.0.0.1',
    });
  });
});
