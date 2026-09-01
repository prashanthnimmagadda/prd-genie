import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { ApiError } from '../../shared/api.js';
import type { ProviderKind } from '../../shared/types.js';
import { createGuardedProviderFetch, validateProviderEndpoint } from './endpoints.js';
import type { ProviderCredential, SessionStore } from './session-store.js';

interface ModelItem {
  id: string;
  name: string;
}

export type ProviderErrorCode =
  | 'missing_credentials'
  | 'invalid_credentials'
  | 'unsupported_model'
  | 'rate_limit'
  | 'context_overflow'
  | 'network_failure'
  | 'cancelled'
  | 'malformed_output'
  | 'provider_unavailable';

export class ProviderService {
  constructor(
    private readonly sessions: SessionStore,
    private readonly guardedFetch = createGuardedProviderFetch(),
  ) {}

  model(sessionId: string | undefined, provider: ProviderKind, modelId: string): LanguageModel {
    const credential = this.sessions.resolve(sessionId, provider);
    if (requiresKey(provider) && !credential.apiKey) {
      throw new ApiError(401, 'missing_credentials', 'Configure a provider key for this session.');
    }
    switch (provider) {
      case 'openai':
        return createOpenAI({ apiKey: credential.apiKey }).chat(modelId);
      case 'anthropic':
        return createAnthropic({ apiKey: credential.apiKey })(modelId);
      case 'google':
        return createGoogleGenerativeAI({ apiKey: credential.apiKey })(modelId);
      case 'openai-compatible': {
        if (!credential.baseUrl) {
          throw new ApiError(400, 'missing_endpoint', 'Configure an OpenAI-compatible endpoint.');
        }
        const baseURL = validateProviderEndpoint(credential.baseUrl);
        return createOpenAICompatible({
          name: 'openai-compatible',
          baseURL,
          apiKey: credential.apiKey,
          headers: credential.headers,
          fetch: this.guardedFetch,
          supportsStructuredOutputs: true,
        })(modelId);
      }
      case 'ollama': {
        const baseURL = validateProviderEndpoint(credential.baseUrl ?? 'http://127.0.0.1:11434/v1');
        return createOpenAICompatible({
          name: 'ollama',
          baseURL,
          apiKey: credential.apiKey ?? 'ollama',
          fetch: this.guardedFetch,
          supportsStructuredOutputs: true,
        })(modelId);
      }
    }
  }

  async listModels(
    sessionId: string | undefined,
    provider: ProviderKind,
    signal?: AbortSignal,
  ): Promise<ModelItem[]> {
    const credential = this.sessions.resolve(sessionId, provider);
    if (requiresKey(provider) && !credential.apiKey) {
      throw new ApiError(401, 'missing_credentials', 'Configure a provider key for this session.');
    }
    const request = modelRequest(provider, credential);
    const requestFetch =
      provider === 'openai-compatible' || provider === 'ollama'
        ? this.guardedFetch
        : globalThis.fetch;
    const response = await requestFetch(request.url, {
      headers: request.headers,
      redirect: 'manual',
      signal: signal ?? AbortSignal.timeout(10_000),
    }).catch((error: unknown) => {
      throw normalizeProviderError(error);
    });
    if (!response.ok) {
      throw normalizeProviderError({ status: response.status });
    }
    const payload: unknown = await response.json();
    return parseModels(provider, payload);
  }
}

function requiresKey(provider: ProviderKind): boolean {
  return provider === 'openai' || provider === 'anthropic' || provider === 'google';
}

function modelRequest(
  provider: ProviderKind,
  credential: ProviderCredential,
): { url: string; headers: Record<string, string> } {
  switch (provider) {
    case 'openai':
      return {
        url: 'https://api.openai.com/v1/models',
        headers: { Authorization: `Bearer ${credential.apiKey ?? ''}` },
      };
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models',
        headers: {
          'x-api-key': credential.apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
      };
    case 'google':
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/models',
        headers: { 'x-goog-api-key': credential.apiKey ?? '' },
      };
    case 'openai-compatible': {
      const baseUrl = validateProviderEndpoint(credential.baseUrl ?? '');
      return {
        url: `${baseUrl.replace(/\/$/, '')}/models`,
        headers: {
          ...(credential.apiKey ? { Authorization: `Bearer ${credential.apiKey}` } : {}),
          ...credential.headers,
        },
      };
    }
    case 'ollama': {
      const base = validateProviderEndpoint(
        credential.baseUrl ?? 'http://127.0.0.1:11434/v1',
      ).replace(/\/v1$/, '');
      return { url: `${base}/api/tags`, headers: {} };
    }
  }
}

function parseModels(provider: ProviderKind, payload: unknown): ModelItem[] {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(502, 'malformed_output', 'The provider returned an invalid model list.');
  }
  const record = payload as Record<string, unknown>;
  const rows =
    provider === 'ollama'
      ? Array.isArray(record.models)
        ? record.models
        : []
      : Array.isArray(record.data)
        ? record.data
        : Array.isArray(record.models)
          ? record.models
          : [];
  return rows
    .flatMap((item): ModelItem[] => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const rawId = row.id ?? row.name;
      if (typeof rawId !== 'string') return [];
      const id = provider === 'google' ? rawId.replace(/^models\//, '') : rawId;
      const displayName = typeof row.displayName === 'string' ? row.displayName : id;
      return [{ id, name: displayName }];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function normalizeProviderError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const value = error as { status?: number; name?: string; message?: string };
  if (value.name === 'AbortError') {
    return new ApiError(499, 'cancelled', 'The provider request was cancelled.');
  }
  if (value.status === 401 || value.status === 403) {
    return new ApiError(401, 'invalid_credentials', 'The provider rejected the credentials.');
  }
  if (value.status === 404) {
    return new ApiError(400, 'unsupported_model', 'The selected model is unavailable.');
  }
  if (value.status === 429) {
    return new ApiError(429, 'rate_limit', 'The provider rate limit was reached.');
  }
  if (value.status === 408 || value.status === 504) {
    return new ApiError(504, 'network_failure', 'The provider request timed out.');
  }
  if (value.status && value.status >= 500) {
    return new ApiError(503, 'provider_unavailable', 'The provider is temporarily unavailable.');
  }
  if (
    /json|schema|grammar|structured|parse|malformed|no object generated|did not match/i.test(
      value.message ?? '',
    )
  ) {
    return new ApiError(
      502,
      'malformed_output',
      'The provider could not produce the required structured output.',
    );
  }
  if (/context|token limit|too long/i.test(value.message ?? '')) {
    return new ApiError(400, 'context_overflow', 'The selected context exceeds the model limit.');
  }
  return new ApiError(502, 'network_failure', 'The provider request could not be completed.');
}
