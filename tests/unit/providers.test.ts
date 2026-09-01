import { describe, expect, it } from 'vitest';
import { fetch as undiciFetch } from 'undici';
import {
  assertSafeProviderDestination,
  createGuardedProviderFetch,
  createPinnedAddressLookup,
  defaultAddressResolver,
  isPublicAddress,
  redactHeaders,
  validateProviderEndpoint,
} from '../../src/server/providers/endpoints.js';
import { ApiError } from '../../src/shared/api.js';
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
    expect(() => validateProviderEndpoint('http://127.999.999.999:11434/v1')).toThrow('valid');
  });

  it('returns header names without their values', () => {
    expect(redactHeaders({ Authorization: 'secret', 'X-Team': 'private' })).toEqual([
      'Authorization',
      'X-Team',
    ]);
  });

  it('rejects private, mixed, metadata, and unresolved remote destinations', async () => {
    await expect(
      assertSafeProviderDestination('https://models.example.com/v1', () =>
        Promise.resolve(['10.0.0.2']),
      ),
    ).rejects.toMatchObject({ code: 'unsafe_endpoint' });
    await expect(
      assertSafeProviderDestination('https://models.example.com/v1', () =>
        Promise.resolve(['93.184.216.34', '169.254.169.254']),
      ),
    ).rejects.toMatchObject({ code: 'unsafe_endpoint' });
    await expect(
      assertSafeProviderDestination('https://models.example.com/v1', () => Promise.resolve([])),
    ).rejects.toMatchObject({ code: 'unsafe_endpoint' });
    await expect(
      assertSafeProviderDestination('https://models.example.com/v1', () =>
        Promise.reject(new Error('DNS unavailable')),
      ),
    ).rejects.toMatchObject({ code: 'endpoint_resolution_failed' });
    await expect(
      assertSafeProviderDestination('https://models.example.com/v1', () =>
        Promise.resolve(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertSafeProviderDestination('https://models.example.com/v1', () =>
        Promise.resolve(['198.52.100.10', '203.1.113.10']),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertSafeProviderDestination('http://127.0.0.1:11434/v1', () =>
        Promise.reject(new Error('Loopback must not resolve externally')),
      ),
    ).resolves.toBeUndefined();
  });

  it('blocks provider redirects before following their destination', async () => {
    const guarded = createGuardedProviderFetch({
      resolveAddresses: () => Promise.resolve(['93.184.216.34']),
      fetch: () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data' },
          }),
        ),
    });
    await expect(guarded('https://models.example.com/v1/models')).rejects.toMatchObject({
      code: 'provider_redirect_blocked',
    });
  });

  it('pins the validated address into the connection lookup', () => {
    const lookup = createPinnedAddressLookup(
      new Map([['models.example.com', ['93.184.216.34', '2606:2800:220:1::1']]]),
    );
    let selected: string | undefined;
    lookup('models.example.com', { family: 4 }, (error, address) => {
      expect(error).toBeNull();
      selected = address as string;
    });
    expect(selected).toBe('93.184.216.34');

    let code: string | undefined;
    lookup('unvalidated.example.com', { family: 4 }, (error) => {
      code = error?.code;
    });
    expect(code).toBe('ENOTFOUND');

    let all: unknown;
    lookup('models.example.com', { family: 0, all: true }, (error, addresses) => {
      expect(error).toBeNull();
      all = addresses;
    });
    expect(all).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]);
  });

  it('classifies reserved IP ranges and permits ordinary public addresses', () => {
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '127.0.0.1',
      '100.64.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '192.0.0.1',
      '192.0.2.1',
      '192.88.99.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '::',
      '::1',
      'fc00::1',
      'fd00::1',
      'fe80::1',
      'ff00::1',
      'fec0::1',
      '64:ff9b:1::1',
      '64:ff9b::7f00:1',
      '64:ff9b::a00:1',
      '64:ff9b::a9fe:1',
      '64:ff9b::c000:201',
      '64:ff9b::e000:1',
      '100::1',
      '2001:2::1',
      '2001:10::1',
      '2002:7f00::1',
      '5f00::1',
      '2001:db8::1',
      '::ffff:127.0.0.1',
      'not-an-address',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of [
      '1.1.1.1',
      '192.31.196.1',
      '198.52.100.1',
      '203.1.113.1',
      '64:ff9b::808:808',
      '2606:4700::1111',
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it('uses the pinned default connection path for URL and Request inputs', async () => {
    let connectionCalls = 0;
    let connectionOptions: Parameters<typeof undiciFetch>[1];
    const connectionFetch: typeof undiciFetch = (_input, init) => {
      connectionCalls += 1;
      connectionOptions = init;
      return Promise.resolve(new Response('{"ok":true}', { status: 200 })) as unknown as ReturnType<
        typeof undiciFetch
      >;
    };
    const guarded = createGuardedProviderFetch({
      connectionFetch,
      resolveAddresses: () => Promise.resolve(['93.184.216.34']),
    });
    expect(await (await guarded(new URL('https://models.example.com/models'))).json()).toEqual({
      ok: true,
    });
    expect((await guarded(new Request('https://models.example.com/models'))).status).toBe(200);
    expect(connectionCalls).toBe(2);
    expect(connectionOptions?.redirect).toBe('manual');
    expect(connectionOptions?.dispatcher).toBeDefined();
    await expect(defaultAddressResolver('localhost')).resolves.not.toHaveLength(0);
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
    expect(normalizeProviderError({ message: 'failed to parse JSON schema grammar' }).code).toBe(
      'malformed_output',
    );
    expect(
      normalizeProviderError({ message: 'No object generated: response did not match' }).code,
    ).toBe('malformed_output');
    expect(normalizeProviderError(new Error('socket failed')).code).toBe('network_failure');
    expect(normalizeProviderError({ status: 403 }).code).toBe('invalid_credentials');
    expect(normalizeProviderError({ status: 408 }).code).toBe('network_failure');
    expect(normalizeProviderError({ status: 500 }).code).toBe('provider_unavailable');
    expect(normalizeProviderError({ status: 400 }).code).toBe('network_failure');
    const existing = new ApiError(400, 'context_overflow', 'Already normalised.');
    expect(normalizeProviderError(existing)).toBe(existing);
  });
});
