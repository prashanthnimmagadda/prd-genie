import { ApiError } from '../../shared/api.js';

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
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
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
