import { describe, expect, it } from 'vitest';
import {
  isAllowedBrowserOrigin,
  isAllowedRequestHost,
  resolveServerHost,
} from '../../src/server/config.js';

describe('server host policy', () => {
  it('allows native loopback and container wildcard hosts only', () => {
    expect(resolveServerHost('127.0.0.1', false)).toBe('127.0.0.1');
    expect(resolveServerHost('::1', false)).toBe('::1');
    expect(resolveServerHost('0.0.0.0', true)).toBe('0.0.0.0');
    expect(() => resolveServerHost('0.0.0.0', false)).toThrow('allowed only');
    expect(() => resolveServerHost('192.168.1.2', true)).toThrow('must be');
  });

  it('accepts only loopback request hosts and same-origin browser requests', () => {
    expect(isAllowedRequestHost('127.0.0.1:3210')).toBe(true);
    expect(isAllowedRequestHost('localhost:3210')).toBe(true);
    expect(isAllowedRequestHost('[::1]:3210')).toBe(true);
    expect(isAllowedRequestHost('private.example:3210')).toBe(false);
    expect(isAllowedRequestHost('127.0.0.1.private.example')).toBe(false);
    expect(isAllowedRequestHost(undefined)).toBe(false);
    expect(isAllowedRequestHost('bad host')).toBe(false);

    expect(isAllowedBrowserOrigin(undefined, '127.0.0.1:3210')).toBe(true);
    expect(isAllowedBrowserOrigin('http://127.0.0.1:3210', '127.0.0.1:3210')).toBe(true);
    expect(isAllowedBrowserOrigin('https://localhost:3210', 'localhost:3210')).toBe(true);
    expect(isAllowedBrowserOrigin('https://private.example', '127.0.0.1:3210')).toBe(false);
    expect(isAllowedBrowserOrigin('http://localhost:9999', 'localhost:3210')).toBe(true);
  });
});
