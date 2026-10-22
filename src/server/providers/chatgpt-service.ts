import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ApiError } from '../../shared/api.js';
import { config } from '../config.js';

const authOrigin = 'https://auth.openai.com';
const apiOrigin = 'https://api.openai.com';
const resource = `${apiOrigin}/v1`;
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const permission = 'chatgpt.tokens.use.direct';

interface Identity {
  sub: string;
  email?: string;
}

interface Credential {
  clientId: string;
  subject: string;
  email: string | null;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresAt: number;
}

interface SavedState {
  hostId: string;
  activeClientId: string | null;
  credentials: Credential[];
}

interface PendingAttempt {
  sessionId: string;
  state: string;
  nonce: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  server: http.Server;
  timer: NodeJS.Timeout;
}

/** OAuth credentials are private to this local installation, never to a PRD project or browser. */
export class ChatGptService {
  private readonly filePath: string | null;
  private saved: SavedState;
  private pending: PendingAttempt | null = null;
  private refreshPromise: Promise<Credential> | null = null;
  private lastError: string | null = null;

  constructor(filePath: string | null = path.join(config.dataDir, 'chatgpt-auth.json')) {
    this.filePath = filePath;
    this.saved = this.readState();
  }

  state() {
    const active = this.active();
    return {
      connected: Boolean(active),
      configured: Boolean(active?.scopes.includes(permission)),
      account: active?.email ?? null,
      activeClientId: this.saved.activeClientId,
      pending: Boolean(this.pending),
      error: this.lastError,
      accounts: this.saved.credentials.map((item) => ({
        clientId: item.clientId,
        email: item.email,
        connected: Boolean(item.accessToken),
      })),
    };
  }

  async begin(sessionId: string, clientId?: string): Promise<{ url: string }> {
    if (this.pending) {
      throw new ApiError(409, 'sign_in_pending', 'Finish or cancel the current ChatGPT sign-in.');
    }
    const prior = clientId
      ? this.saved.credentials.find((item) => item.clientId === clientId)
      : undefined;
    if (clientId && !prior) {
      throw new ApiError(
        404,
        'chatgpt_account_missing',
        'That ChatGPT registration is unavailable.',
      );
    }
    this.persist(); // Persist this host identifier before its first authorization.
    const server = http.createServer((request, response) => {
      void this.receiveCallback(request, response).catch(() => {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('ChatGPT sign-in could not finish. Return to PRD Genie.');
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new ApiError(
        500,
        'callback_unavailable',
        'Could not start the local sign-in callback.',
      );
    }
    const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const timer = setTimeout(() => this.endPending(), 5 * 60_000);
    timer.unref();
    this.pending = {
      sessionId,
      state,
      nonce,
      verifier,
      clientId: clientId ?? 'dynamic_agent_client',
      redirectUri,
      server,
      timer,
    };
    this.lastError = null;
    const url = new URL('/api/accounts/authorize', authOrigin);
    url.searchParams.set('client_id', this.pending.clientId);
    if (!prior) url.searchParams.set('agent_name_hint', 'PRD Genie');
    if (prior?.idToken) url.searchParams.set('id_token_hint', prior.idToken);
    if (prior?.email) url.searchParams.set('login_hint', prior.email);
    url.searchParams.set('ext_agent_host_id', this.saved.hostId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes);
    if (prior && !prior.scopes.includes(permission)) url.searchParams.set('prompt', 'consent');
    url.searchParams.set('resource', resource);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set(
      'code_challenge',
      createHash('sha256').update(verifier).digest('base64url'),
    );
    return { url: url.toString() };
  }

  cancel(): void {
    this.endPending();
  }

  select(clientId: string): void {
    const account = this.saved.credentials.find(
      (item) => item.clientId === clientId && item.accessToken,
    );
    if (!account)
      throw new ApiError(404, 'chatgpt_account_missing', 'That ChatGPT account is not connected.');
    this.saved.activeClientId = clientId;
    this.persist();
  }

  async signOut(): Promise<{ revocationConfirmed: boolean }> {
    const active = this.active();
    this.saved.activeClientId = null;
    if (!active) return { revocationConfirmed: true };
    let revocationConfirmed = false;
    try {
      const discovery = await this.discovery();
      const endpoint = new URL(discovery.revocation_endpoint);
      if (endpoint.origin !== authOrigin) throw new Error('Unexpected revocation endpoint.');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: active.refreshToken,
          token_type_hint: 'refresh_token',
          client_id: active.clientId,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      revocationConfirmed = response.ok;
    } catch {
      // The local session still ends; the user can revoke it in ChatGPT Settings.
    }
    this.saved.credentials = this.saved.credentials.map((item) =>
      item.clientId === active.clientId
        ? { ...item, idToken: '', accessToken: '', refreshToken: '', expiresAt: 0 }
        : item,
    );
    this.persist();
    return { revocationConfirmed };
  }

  async listModels(signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> {
    const token = await this.accessToken();
    const response = await fetch(`${resource}/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: signal ?? AbortSignal.timeout(10_000),
      redirect: 'manual',
    }).catch(() => {
      throw new ApiError(502, 'network_failure', 'ChatGPT model discovery could not connect.');
    });
    if (!response.ok) throw await this.responseError(response);
    const payload = (await response.json()) as { models?: unknown };
    if (!Array.isArray(payload.models)) {
      throw new ApiError(502, 'malformed_output', 'ChatGPT returned an invalid model catalog.');
    }
    return payload.models.flatMap((row): Array<{ id: string; name: string }> => {
      if (!row || typeof row !== 'object') return [];
      const item = row as Record<string, unknown>;
      return item.visibility === 'list' && typeof item.slug === 'string'
        ? [
            {
              id: item.slug,
              name: typeof item.display_name === 'string' ? item.display_name : item.slug,
            },
          ]
        : [];
    });
  }

  async response(
    model: string,
    instructions: string,
    input: string,
    signal: AbortSignal,
  ): Promise<string> {
    const token = await this.accessToken();
    const response = await fetch(`${resource}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions,
        input: [{ role: 'user', content: input }],
        store: false,
        stream: true,
      }),
      signal,
      redirect: 'manual',
    }).catch((error: unknown) => {
      if (signal.aborted)
        throw new ApiError(499, 'cancelled', 'ChatGPT generation was interrupted.');
      void error;
      throw new ApiError(502, 'network_failure', 'ChatGPT generation could not connect.');
    });
    if (!response.ok) throw await this.responseError(response);
    if (!response.body)
      throw new ApiError(502, 'incomplete_response', 'ChatGPT returned no response stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';
    let completed = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let match = /\r?\n\r?\n/.exec(buffer);
        while (match) {
          const block = buffer.slice(0, match.index).replace(/\r/g, '');
          buffer = buffer.slice(match.index + match[0].length);
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (data && data !== '[DONE]') {
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(data) as Record<string, unknown>;
            } catch {
              throw new ApiError(
                502,
                'malformed_output',
                'ChatGPT returned a malformed stream event.',
              );
            }
            if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
              output += event.delta;
              if (output.length > 1_000_000)
                throw new ApiError(
                  502,
                  'response_too_large',
                  'ChatGPT response exceeded the supported size.',
                );
            }
            if (event.type === 'response.failed' || event.type === 'response.incomplete') {
              const detail = event.response as { error?: { code?: string } } | undefined;
              const code =
                typeof detail?.error?.code === 'string' ? detail.error.code : 'incomplete_response';
              throw new ApiError(
                code === 'subscription_sharing_usage_limit_exceeded' ? 429 : 502,
                code,
                code === 'subscription_sharing_usage_limit_exceeded'
                  ? 'ChatGPT plan usage limit reached. Check ChatGPT Settings → Usage. The partial output was not applied.'
                  : 'ChatGPT did not complete this response. The partial output was not applied.',
              );
            }
            if (event.type === 'response.completed') completed = true;
          }
          match = /\r?\n\r?\n/.exec(buffer);
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (!completed)
      throw new ApiError(
        502,
        'incomplete_response',
        'ChatGPT connection ended before completion. The partial output was not applied.',
      );
    return output;
  }

  private async receiveCallback(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const pending = this.pending;
    if (!pending) {
      response.writeHead(410);
      response.end();
      return;
    }
    const url = new URL(request.url ?? '/', pending.redirectUri);
    if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
      response.writeHead(404);
      response.end();
      return;
    }
    if (url.searchParams.get('state') !== pending.state) {
      response.writeHead(400);
      response.end('Sign-in state did not match.');
      return;
    }
    try {
      if (url.searchParams.has('error'))
        throw new ApiError(400, 'consent_declined', 'ChatGPT permission was declined.');
      const code = url.searchParams.get('code');
      const callbackClientId = url.searchParams.get('client_id');
      const clientId =
        pending.clientId === 'dynamic_agent_client' ? callbackClientId : pending.clientId;
      if (
        !code ||
        !clientId ||
        clientId === 'dynamic_agent_client' ||
        (pending.clientId !== 'dynamic_agent_client' &&
          callbackClientId &&
          callbackClientId !== pending.clientId)
      ) {
        throw new ApiError(
          400,
          'invalid_callback',
          'ChatGPT registration returned an invalid code or client.',
        );
      }
      const tokenResponse = await fetch(`${authOrigin}/api/accounts/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          code_verifier: pending.verifier,
          redirect_uri: pending.redirectUri,
          resource,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!tokenResponse.ok)
        throw new ApiError(
          401,
          'token_exchange_failed',
          'ChatGPT sign-in could not exchange the authorization code.',
        );
      const tokens = (await tokenResponse.json()) as Record<string, unknown>;
      const idToken = requiredString(tokens.id_token);
      const identity = await this.verifyIdentity(idToken, clientId, pending.nonce);
      const previous = this.saved.credentials.find((item) => item.clientId === clientId);
      if (previous && previous.subject !== identity.sub) {
        throw new ApiError(
          401,
          'account_mismatch',
          'A different ChatGPT account returned for this registration.',
        );
      }
      const credential: Credential = {
        clientId,
        subject: identity.sub,
        email: identity.email ?? null,
        idToken,
        accessToken: requiredString(tokens.access_token),
        refreshToken: requiredString(tokens.refresh_token),
        scopes: requiredString(tokens.scope).split(/\s+/),
        expiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
      };
      this.saved.credentials = [
        ...this.saved.credentials.filter((item) => item.clientId !== clientId),
        credential,
      ];
      this.saved.activeClientId = clientId;
      this.persist();
      this.lastError = null;
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(
        '<!doctype html><title>PRD Genie</title><p>ChatGPT connection saved. Return to PRD Genie.</p>',
      );
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'ChatGPT sign-in failed.';
      response.writeHead(400, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end('ChatGPT sign-in could not finish. Return to PRD Genie.');
    } finally {
      this.endPending();
    }
  }

  private async verifyIdentity(token: string, clientId: string, nonce: string): Promise<Identity> {
    const parts = token.split('.');
    if (parts.length !== 3)
      throw new ApiError(401, 'invalid_identity', 'ChatGPT returned an invalid identity token.');
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (!['RS256', 'ES256'].includes(header.alg ?? '') || !header.kid)
      throw new ApiError(401, 'invalid_identity', 'ChatGPT identity signature is unsupported.');
    const discovery = await this.discovery();
    const jwksUrl = new URL(discovery.jwks_uri);
    if (jwksUrl.origin !== authOrigin)
      throw new ApiError(401, 'invalid_identity', 'ChatGPT identity key location is invalid.');
    const keysResponse = await fetch(jwksUrl, { signal: AbortSignal.timeout(10_000) });
    if (!keysResponse.ok)
      throw new ApiError(
        502,
        'identity_keys_unavailable',
        'ChatGPT identity keys are unavailable.',
      );
    const keys = (await keysResponse.json()) as { keys?: Array<Record<string, unknown>> };
    const jwk = keys.keys?.find(
      (key) => key.kid === header.kid && (!key.alg || key.alg === header.alg),
    );
    if (!jwk)
      throw new ApiError(401, 'invalid_identity', 'ChatGPT identity signing key was not found.');
    const options =
      header.alg === 'ES256'
        ? { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' as const }
        : createPublicKey({ key: jwk, format: 'jwk' });
    if (
      !verify(
        'sha256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        options,
        Buffer.from(parts[2]!, 'base64url'),
      ) ||
      claims.iss !== authOrigin ||
      claims.aud !== clientId ||
      claims.nonce !== nonce ||
      typeof claims.exp !== 'number' ||
      claims.exp <= Date.now() / 1000 ||
      typeof claims.sub !== 'string'
    ) {
      throw new ApiError(401, 'invalid_identity', 'ChatGPT identity verification failed.');
    }
    return {
      sub: claims.sub,
      ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
    };
  }

  private async discovery(): Promise<{ jwks_uri: string; revocation_endpoint: string }> {
    const response = await fetch(`${authOrigin}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new ApiError(
        502,
        'identity_unavailable',
        'ChatGPT identity configuration is unavailable.',
      );
    return (await response.json()) as { jwks_uri: string; revocation_endpoint: string };
  }

  private async accessToken(): Promise<string> {
    const active = this.active();
    if (!active || !active.scopes.includes(permission))
      throw new ApiError(
        401,
        'chatgpt_not_ready',
        'Connect ChatGPT and approve plan usage in AI settings.',
      );
    if (active.expiresAt > Date.now() + 60_000) return active.accessToken;
    if (!this.refreshPromise)
      this.refreshPromise = this.refresh(active).finally(() => {
        this.refreshPromise = null;
      });
    return (await this.refreshPromise).accessToken;
  }

  private async refresh(active: Credential): Promise<Credential> {
    if (!active.refreshToken)
      throw new ApiError(401, 'chatgpt_sign_in_required', 'Sign in to ChatGPT again.');
    const response = await fetch(`${authOrigin}/api/accounts/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: active.clientId,
        refresh_token: active.refreshToken,
        resource,
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new ApiError(
        502,
        'network_failure',
        'Could not refresh the ChatGPT connection. Try again when online.',
      );
    });
    if (!response.ok) {
      let code = '';
      try {
        const body = (await response.json()) as { error?: string | { code?: string } };
        code = typeof body.error === 'string' ? body.error : (body.error?.code ?? '');
      } catch {
        /* Nonstandard gateway response. */
      }
      if (
        [
          'invalid_grant',
          'invalid_refresh_token',
          'token_expired',
          'refresh_token_expired',
          'refresh_token_invalidated',
          'refresh_token_reused',
        ].includes(code)
      ) {
        this.saved.credentials = this.saved.credentials.map((item) =>
          item.clientId === active.clientId
            ? { ...item, idToken: '', accessToken: '', refreshToken: '', expiresAt: 0 }
            : item,
        );
        this.persist();
        throw new ApiError(
          401,
          'chatgpt_sign_in_required',
          'ChatGPT access expired. Sign in again.',
        );
      }
      throw new ApiError(503, 'provider_unavailable', 'ChatGPT access could not be refreshed yet.');
    }
    const tokens = (await response.json()) as Record<string, unknown>;
    const updated = {
      ...active,
      accessToken: requiredString(tokens.access_token),
      refreshToken: requiredString(tokens.refresh_token),
      scopes: typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : active.scopes,
      expiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
    };
    this.saved.credentials = this.saved.credentials.map((item) =>
      item.clientId === active.clientId ? updated : item,
    );
    this.persist();
    return updated;
  }

  private async responseError(response: Response): Promise<ApiError> {
    let code = `http_${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string } };
      if (typeof body.error?.code === 'string') code = body.error.code;
    } catch {
      /* Admission errors need not use the standard Responses shape. */
    }
    const explanation =
      code === 'subscription_sharing_usage_limit_exceeded'
        ? 'ChatGPT plan usage limit reached. Check ChatGPT Settings → Usage.'
        : code === 'subscription_sharing_user_not_eligible'
          ? 'This ChatGPT account or workspace is not eligible for plan usage.'
          : code === 'subscription_sharing_unsupported_capability'
            ? 'The selected ChatGPT model does not support this request.'
            : `ChatGPT could not complete the request (${code}).`;
    return new ApiError(response.status, code, explanation);
  }

  private active(): Credential | undefined {
    return this.saved.credentials.find(
      (item) => item.clientId === this.saved.activeClientId && item.accessToken,
    );
  }

  private endPending(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.server.close();
    this.pending = null;
  }

  private readState(): SavedState {
    if (this.filePath === null) {
      return { hostId: `urn:uuid:${randomUUID()}`, activeClientId: null, credentials: [] };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as SavedState;
      if (raw.hostId?.startsWith('urn:uuid:') && Array.isArray(raw.credentials)) return raw;
    } catch {
      /* A missing file is normal on first use. */
    }
    return { hostId: `urn:uuid:${randomUUID()}`, activeClientId: null, credentials: [] };
  }

  private persist(): void {
    if (this.filePath === null) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.saved), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value)
    throw new ApiError(
      502,
      'invalid_token_response',
      'ChatGPT returned an incomplete token response.',
    );
  return value;
}
