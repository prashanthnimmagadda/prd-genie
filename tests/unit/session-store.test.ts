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

  it('treats a keyless compatible endpoint as configured', () => {
    const store = new SessionStore();
    const session = store.create();
    store.setProvider(session.id, 'openai-compatible', {
      baseUrl: 'http://127.0.0.1:1234/v1',
    });
    expect(store.state(session.id, 'openai-compatible')).toMatchObject({
      configured: true,
      credentialSource: 'session',
      baseUrl: '127.0.0.1',
    });
  });

  it('keeps a returned credential separate from the in-memory copy', () => {
    const store = new SessionStore();
    const session = store.create();
    const headers = { 'X-Workspace': 'one' };
    store.setProvider(session.id, 'openai-compatible', {
      baseUrl: 'https://models.example.test/v1',
      headers,
    });
    const returned = store.resolve(session.id, 'openai-compatible');
    returned.baseUrl = 'https://different.example.test/v1';
    expect(store.resolve(session.id, 'openai-compatible').baseUrl).toBe(
      'https://models.example.test/v1',
    );
    store.clearProvider('missing-session', 'openai-compatible');
    expect(store.get(undefined)).toBeUndefined();
  });

  it('reports configured provider destinations without exposing invalid endpoint text', () => {
    const store = new SessionStore();
    const session = store.create();
    store.setProvider(session.id, 'openai-compatible', { baseUrl: 'invalid endpoint' });
    expect(store.state(session.id, 'openai-compatible')).toMatchObject({
      configured: true,
      baseUrl: null,
    });
    expect(store.state(undefined, 'chatgpt')).toMatchObject({
      configured: false,
      credentialSource: 'none',
      baseUrl: 'api.openai.com',
    });
    expect(store.state(undefined, 'anthropic').baseUrl).toBe('api.anthropic.com');
    expect(store.state(undefined, 'google').baseUrl).toBe('generativelanguage.googleapis.com');
  });
});
