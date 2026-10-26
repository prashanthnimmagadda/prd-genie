import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatGptService } from '../../src/server/providers/chatgpt-service.js';

const directories: string[] = [];
const mockAccessToken = ['synthetic', 'access', 'token'].join('-');
const mockRefreshToken = ['synthetic', 'refresh', 'token'].join('-');

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function connectedService(
  options: { expiresAt?: number; scopes?: string[]; refreshToken?: string } = {},
): ChatGptService {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-chatgpt-'));
  directories.push(directory);
  const file = path.join(directory, 'chatgpt-auth.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      hostId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
      activeClientId: 'oaiapp_test',
      credentials: [
        {
          clientId: 'oaiapp_test',
          subject: 'subject',
          email: 'sample@example.test',
          idToken: 'synthetic',
          accessToken: mockAccessToken,
          refreshToken: options.refreshToken ?? mockRefreshToken,
          scopes: options.scopes ?? ['chatgpt.tokens.use.direct'],
          expiresAt: options.expiresAt ?? Date.now() + 3600_000,
        },
      ],
    }),
    { mode: 0o600 },
  );
  return new ChatGptService(file);
}

describe('ChatGPT plan provider', () => {
  it('requests the account catalog and only offers visible models', async () => {
    const service = connectedService();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { slug: 'model-a', display_name: 'Model A', visibility: 'list' },
            { slug: 'model-hidden', display_name: 'Hidden', visibility: 'hidden' },
          ],
        }),
        { status: 200 },
      ),
    );
    expect(await service.listModels()).toEqual([{ id: 'model-a', name: 'Model A' }]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/models');
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${mockAccessToken}`,
    );
  });

  it('requires a terminal completion event and never accepts an interrupted stream', async () => {
    const service = connectedService();
    const stream = (events: string) =>
      new Response(events, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        stream(
          'data: {"type":"response.output_text.delta","delta":"Draft"}\r\n\r\n' +
            'data: {"type":"response.completed"}\r\n\r\n',
        ),
      )
      .mockResolvedValueOnce(
        stream('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n'),
      );
    expect(
      await service.response('model-a', 'instructions', 'user input', new AbortController().signal),
    ).toBe('Draft');
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(options!.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ store: false, stream: true, model: 'model-a' });
    expect(body).not.toHaveProperty('max_output_tokens');
    await expect(
      service.response('model-a', 'instructions', 'user input', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'incomplete_response' });
  });

  it('stops on a streamed usage-limit error without switching providers', async () => {
    const service = connectedService();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          'data: {"type":"response.output_text.delta","delta":"Partial"}\n\n' +
            'data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n',
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    await expect(
      service.response('model-a', 'instructions', 'user input', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'subscription_sharing_usage_limit_exceeded' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not create a persistent connection before user authorization', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-chatgpt-'));
    directories.push(directory);
    const file = path.join(directory, 'chatgpt-auth.json');
    const service = new ChatGptService(file);
    expect(fs.existsSync(file)).toBe(false);
    expect(service.state().configured).toBe(false);
    expect(service.state().connected).toBe(false);
  });

  it('refreshes an expired connection and persists rotated tokens before model discovery', async () => {
    const service = connectedService({ expiresAt: Date.now() - 1 });
    const rotatedAccess = ['rotated', 'access', 'value'].join('-');
    const rotatedRefresh = ['rotated', 'refresh', 'value'].join('-');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: rotatedAccess,
            refresh_token: rotatedRefresh,
            expires_in: 3600,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ slug: 'eligible', visibility: 'list' }] })),
      );
    expect(await service.listModels()).toEqual([{ id: 'eligible', name: 'eligible' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${rotatedAccess}`,
    );
    expect(service.state().configured).toBe(true);
  });

  it('clears a revoked refresh token but preserves a transiently unavailable connection', async () => {
    const expired = connectedService({ expiresAt: Date.now() - 1 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
    await expect(expired.listModels()).rejects.toMatchObject({
      code: 'chatgpt_sign_in_required',
    });
    expect(expired.state().connected).toBe(false);

    const transient = connectedService({ expiresAt: Date.now() - 1 });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    await expect(transient.listModels()).rejects.toMatchObject({ code: 'network_failure' });
    expect(transient.state().connected).toBe(true);
  });

  it('rejects malformed catalogs and streams without accepting partial content', async () => {
    const service = connectedService();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: 'invalid' })))
      .mockResolvedValueOnce(
        new Response('data: not-json\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(service.listModels()).rejects.toMatchObject({ code: 'malformed_output' });
    await expect(
      service.response('model-a', 'instructions', 'input', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'malformed_output' });
    await expect(
      service.response('model-a', 'instructions', 'input', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'incomplete_response' });
  });

  it('ends the local connection even when remote revocation fails', async () => {
    const service = connectedService();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revocation_endpoint: 'https://auth.openai.com/revoke' })),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await service.signOut()).toEqual({ revocationConfirmed: false });
    expect(service.state()).toMatchObject({ connected: false, configured: false });
    expect(await service.signOut()).toEqual({ revocationConfirmed: true });
  });
});
