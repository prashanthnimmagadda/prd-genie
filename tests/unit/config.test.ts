import { describe, expect, it } from 'vitest';
import { resolveServerHost } from '../../src/server/config.js';

describe('server host policy', () => {
  it('allows native loopback and container wildcard hosts only', () => {
    expect(resolveServerHost('127.0.0.1', false)).toBe('127.0.0.1');
    expect(resolveServerHost('::1', false)).toBe('::1');
    expect(resolveServerHost('0.0.0.0', true)).toBe('0.0.0.0');
    expect(() => resolveServerHost('0.0.0.0', false)).toThrow('allowed only');
    expect(() => resolveServerHost('192.168.1.2', true)).toThrow('must be');
  });
});
