import { lookup } from 'node:dns/promises';
import net, { type LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch } from 'undici';
import { ApiError } from '../../shared/api.js';

type AddressResolver = (hostname: string) => Promise<string[]>;
type ProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type ConnectionFetch = typeof undiciFetch;

export function validateProviderEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, 'invalid_endpoint', 'Enter a valid provider endpoint URL.');
  }
  if (url.username || url.password) {
    throw new ApiError(
      400,
      'embedded_credentials',
      'Credentials are not allowed in endpoint URLs.',
    );
  }
  if (url.protocol === 'https:') return url.toString().replace(/\/$/, '');
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '::1' ||
    url.hostname === '[::1]' ||
    (net.isIPv4(url.hostname) && url.hostname.startsWith('127.'));
  if (url.protocol === 'http:' && loopback) return url.toString().replace(/\/$/, '');
  throw new ApiError(
    400,
    'insecure_endpoint',
    'Custom endpoints must use HTTPS. Loopback HTTP is allowed for local models.',
  );
}

export function redactHeaders(headers: Record<string, string> | undefined): string[] {
  return Object.keys(headers ?? {}).sort();
}

export async function assertSafeProviderDestination(
  value: string,
  resolveAddresses: AddressResolver = defaultAddressResolver,
): Promise<void> {
  await resolveSafeProviderAddresses(value, resolveAddresses);
}

async function resolveSafeProviderAddresses(
  value: string,
  resolveAddresses: AddressResolver,
): Promise<string[]> {
  const normalized = validateProviderEndpoint(value);
  const url = new URL(normalized);
  if (isLoopbackHostname(url.hostname)) {
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
      return [url.hostname.replace(/^\[|\]$/g, '')];
    }
    return ['127.0.0.1', '::1'];
  }

  const addresses = net.isIP(url.hostname)
    ? [url.hostname]
    : await resolveAddresses(url.hostname).catch(() => {
        throw new ApiError(
          502,
          'endpoint_resolution_failed',
          'The provider endpoint hostname could not be resolved safely.',
        );
      });
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new ApiError(
      400,
      'unsafe_endpoint',
      'Remote provider endpoints must resolve only to public network addresses.',
    );
  }
  return addresses;
}

export function createGuardedProviderFetch(
  options: {
    resolveAddresses?: AddressResolver;
    fetch?: ProviderFetch;
    connectionFetch?: ConnectionFetch;
  } = {},
): ProviderFetch {
  const resolveAddresses = options.resolveAddresses ?? defaultAddressResolver;
  const pinnedAddresses = new Map<string, string[]>();
  const dispatcher = options.fetch
    ? null
    : new Agent({ connect: { lookup: createPinnedAddressLookup(pinnedAddresses) } });
  return async (input, init) => {
    const url = requestUrl(input);
    const addresses = await resolveSafeProviderAddresses(url, resolveAddresses);
    pinnedAddresses.set(new URL(url).hostname.toLowerCase(), addresses);
    const response = options.fetch
      ? await options.fetch(input, { ...init, redirect: 'manual' })
      : ((await (options.connectionFetch ?? undiciFetch)(
          input as Parameters<typeof undiciFetch>[0],
          {
            ...(init as Parameters<typeof undiciFetch>[1]),
            redirect: 'manual',
            dispatcher: dispatcher!,
          },
        )) as unknown as Response);
    if (response.status >= 300 && response.status < 400) {
      throw new ApiError(
        502,
        'provider_redirect_blocked',
        'Provider redirects are blocked to protect the local network boundary.',
      );
    }
    return response;
  };
}

export function createPinnedAddressLookup(
  pinnedAddresses: ReadonlyMap<string, string[]>,
): LookupFunction {
  return (hostname, lookupOptions, callback) => {
    const addresses = pinnedAddresses.get(hostname.toLowerCase()) ?? [];
    const family = typeof lookupOptions.family === 'number' ? lookupOptions.family : 0;
    const eligible =
      family === 0 ? addresses : addresses.filter((address) => net.isIP(address) === family);
    if (eligible.length === 0) {
      const error = new Error(
        'The validated provider address is unavailable.',
      ) as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      callback(error, '');
      return;
    }
    if (lookupOptions.all) {
      callback(
        null,
        eligible.map((address) => ({ address, family: net.isIP(address) })),
      );
      return;
    }
    callback(null, eligible[0]!, net.isIP(eligible[0]!));
  };
}

export async function defaultAddressResolver(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    (net.isIPv4(normalized) && normalized.startsWith('127.'))
  );
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (!net.isIP(normalized)) return false;
  const parsed = ipaddr.parse(normalized);
  if (parsed.kind() === 'ipv4') {
    return ['unicast', 'as112'].includes(parsed.range());
  }
  const ipv6 = parsed as ipaddr.IPv6;
  if (ipv6.isIPv4MappedAddress()) {
    return isPublicAddress(ipv6.toIPv4Address().toString());
  }
  const range = ipv6.range();
  if (range === 'rfc6052') {
    return ipv6.match(ipaddr.parseCIDR('64:ff9b::/96'));
  }
  return ['unicast', 'amt', 'as112v6', 'orchid2', 'droneRemoteIdProtocolEntityTags'].includes(
    range,
  );
}
