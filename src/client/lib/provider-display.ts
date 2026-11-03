import type { ProviderKind, ProviderState } from '@shared/types';

export const providerLabels: Record<ProviderKind, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google Gemini',
  'openai-compatible': 'OpenAI-compatible endpoint',
  chatgpt: 'ChatGPT plan',
  ollama: 'Ollama',
};

/** Order used by AI settings and the model menu: online providers, then this Mac. */
export const onlineProviders: ProviderKind[] = [
  'anthropic',
  'openai',
  'google',
  'openai-compatible',
  'chatgpt',
];
export const localProviders: ProviderKind[] = ['ollama'];

export function isLocalProvider(state: ProviderState | null | undefined): boolean {
  return Boolean(
    state?.baseUrl &&
    ['localhost', '127.0.0.1', '::1', '[::1]'].includes(state.baseUrl.toLowerCase()),
  );
}

export function providerIsLocal(provider: ProviderKind, state?: ProviderState | null): boolean {
  return provider === 'ollama' || isLocalProvider(state);
}

export function defaultHost(provider: ProviderKind): string | null {
  switch (provider) {
    case 'anthropic':
      return 'api.anthropic.com';
    case 'openai':
      return 'api.openai.com';
    case 'google':
      return 'generativelanguage.googleapis.com';
    case 'chatgpt':
      return 'chatgpt.com';
    case 'ollama':
      return 'localhost:11434';
    default:
      return null;
  }
}

/** Second line for a provider row in AI settings and the composer menu. */
export function providerStatus(
  provider: ProviderKind,
  state: ProviderState | null | undefined,
  offline = false,
): { text: string; tone: 'ok' | 'warning' | 'muted' } {
  if (provider === 'chatgpt') {
    if (state?.pending) return { text: 'Finishing sign-in…', tone: 'muted' };
    if (state?.configured && state.error) return { text: 'Sign-in expired', tone: 'warning' };
    if (state?.configured) return { text: offline ? 'Offline' : 'Ready · signed in', tone: 'ok' };
    if (state?.connected) return { text: 'Signed in · not enabled', tone: 'warning' };
    return { text: 'Not signed in', tone: 'muted' };
  }
  if (!state?.configured) return { text: 'Not set up', tone: 'muted' };
  if (offline && !providerIsLocal(provider, state)) return { text: 'Offline', tone: 'warning' };
  if (provider === 'ollama' || provider === 'openai-compatible')
    return { text: `Ready · ${state.baseUrl ?? 'endpoint set'}`, tone: 'ok' };
  return {
    text:
      state.credentialSource === 'environment' ? 'Ready · environment key' : 'Ready · session key',
    tone: 'ok',
  };
}
