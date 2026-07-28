import { describe, expect, it } from 'vitest';
import { redactHeaders, validateProviderEndpoint } from '../../src/server/providers/endpoints.js';
import { normalizeProviderError } from '../../src/server/providers/provider-service.js';

describe('provider endpoint validation', () => {
  it('accepts HTTPS and loopback HTTP', () => {
    expect(validateProviderEndpoint('https://models.example.com/v1')).toBe(
      'https://models.example.com/v1',
    );
    expect(validateProviderEndpoint('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1');
    expect(validateProviderEndpoint('http://localhost:1234/v1')).toBe('http://localhost:1234/v1');
  });

  it('rejects remote HTTP and URL credentials', () => {
    expect(() => validateProviderEndpoint('http://models.example.com/v1')).toThrow(
      'must use HTTPS',
    );
    expect(() => validateProviderEndpoint('https://user:pass@example.com/v1')).toThrow(
      'Credentials',
    );
    expect(() => validateProviderEndpoint('not a URL')).toThrow('valid');
  });

  it('returns header names without their values', () => {
    expect(redactHeaders({ Authorization: 'secret', 'X-Team': 'private' })).toEqual([
      'Authorization',
      'X-Team',
    ]);
  });
});

describe('provider error normalization', () => {
  it.each([
    [401, 'invalid_credentials'],
    [404, 'unsupported_model'],
    [429, 'rate_limit'],
    [504, 'network_failure'],
    [503, 'provider_unavailable'],
  ])('maps status %i to %s', (status, code) => {
    expect(normalizeProviderError({ status }).code).toBe(code);
  });

  it('recognises context and cancellation failures', () => {
    expect(normalizeProviderError({ message: 'context token limit reached' }).code).toBe(
      'context_overflow',
    );
    expect(normalizeProviderError({ name: 'AbortError' }).code).toBe('cancelled');
    expect(normalizeProviderError(new Error('socket failed')).code).toBe('network_failure');
  });
});
