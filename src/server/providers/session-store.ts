import type { CredentialSource, ProviderKind, ProviderState } from '../../shared/types.js';
import { config } from '../config.js';

export interface ProviderCredential {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}

interface Session {
  id: string;
  touchedAt: number;
  providers: Partial<Record<ProviderKind, ProviderCredential>>;
}

const environmentKeys: Record<ProviderKind, string | undefined> = {
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  google: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  'openai-compatible': process.env.OPENAI_COMPATIBLE_API_KEY,
  ollama: 'ollama',
};

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  create(): Session {
    const session: Session = {
      id: crypto.randomUUID(),
      touchedAt: Date.now(),
      providers: {},
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string | undefined): Session | undefined {
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (Date.now() - session.touchedAt > config.sessionIdleMs) {
      this.sessions.delete(id);
      return undefined;
    }
    session.touchedAt = Date.now();
    return session;
  }

  setProvider(id: string, provider: ProviderKind, credential: ProviderCredential): void {
    const session = this.get(id);
    if (!session) throw new Error('Session is unavailable.');
    session.providers[provider] = { ...credential };
  }

  clearProvider(id: string, provider: ProviderKind): void {
    const session = this.get(id);
    if (!session) return;
    delete session.providers[provider];
  }

  clearSession(id: string): void {
    this.sessions.delete(id);
  }

  resolve(id: string | undefined, provider: ProviderKind): ProviderCredential {
    const sessionCredential = this.get(id)?.providers[provider];
    if (sessionCredential) return { ...sessionCredential };
    const apiKey = environmentKeys[provider];
    const baseUrl =
      provider === 'openai-compatible'
        ? process.env.OPENAI_COMPATIBLE_BASE_URL
        : provider === 'ollama'
          ? (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1')
          : undefined;
    return {
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    };
  }

  state(id: string | undefined, provider: ProviderKind): ProviderState {
    const sessionCredential = this.get(id)?.providers[provider];
    const source: CredentialSource = sessionCredential
      ? 'session'
      : environmentKeys[provider]
        ? 'environment'
        : 'none';
    const resolved = this.resolve(id, provider);
    return {
      provider,
      credentialSource: source,
      configured: provider === 'ollama' || Boolean(resolved.apiKey),
      baseUrl: resolved.baseUrl ? safeHostname(resolved.baseUrl) : defaultHostname(provider),
    };
  }
}

function defaultHostname(provider: ProviderKind): string | null {
  switch (provider) {
    case 'openai':
      return 'api.openai.com';
    case 'anthropic':
      return 'api.anthropic.com';
    case 'google':
      return 'generativelanguage.googleapis.com';
    case 'ollama':
      return '127.0.0.1';
    case 'openai-compatible':
      return null;
  }
}

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}
