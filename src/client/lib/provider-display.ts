import type { ProviderKind, ProviderState } from '@shared/types';

export const providerLabels: Record<ProviderKind, string> = {
  chatgpt: 'ChatGPT plan',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  'openai-compatible': 'Local / OpenAI-compatible',
  ollama: 'Local Ollama',
};

export function isLocalProvider(state: ProviderState | null | undefined): boolean {
  return Boolean(
    state?.baseUrl &&
    ['localhost', '127.0.0.1', '::1', '[::1]'].includes(state.baseUrl.toLowerCase()),
  );
}
