import { useEffect, useState } from 'react';
import { Check, ChevronDown, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { ProjectSummary, ProviderKind, ProviderState } from '@shared/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector';

const providerLabels: Record<ProviderKind, string> = {
  chatgpt: 'ChatGPT plan',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  'openai-compatible': 'OpenAI-compatible',
  ollama: 'Local Ollama',
};

interface ProviderDialogProps {
  open: boolean;
  project: ProjectSummary;
  onOpenChange: (open: boolean) => void;
  onProjectChange: (project: ProjectSummary) => void;
}

export function ProviderDialog({
  open,
  project,
  onOpenChange,
  onProjectChange,
}: ProviderDialogProps) {
  const [provider, setProvider] = useState<ProviderKind>(project.selectedProvider ?? 'openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [states, setStates] = useState<ProviderState[]>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [model, setModel] = useState(project.selectedModel ?? '');
  const [busy, setBusy] = useState(false);
  const [statesLoading, setStatesLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    void api
      .providerStates()
      .then(({ providers }) => setStates(providers))
      .catch((reason: unknown) => setError(messageFrom(reason)))
      .finally(() => setStatesLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open || provider !== 'chatgpt') return;
    const refresh = () => {
      void api
        .providerStates()
        .then(({ providers }) => setStates(providers))
        .catch(() => undefined);
    };
    refresh();
    const interval = window.setInterval(refresh, 1800);
    return () => window.clearInterval(interval);
  }, [open, provider]);

  const currentState = states.find((state) => state.provider === provider);
  const typedBaseUrl = baseUrl.trim();
  const hasDraftConfiguration = Boolean(apiKey || typedBaseUrl || headersText.trim());
  const endpointToSubmit = typedBaseUrl || undefined;
  const missingCompatibleEndpoint =
    provider === 'openai-compatible' &&
    (!currentState?.configured || hasDraftConfiguration) &&
    !typedBaseUrl;

  function clearDraftConfiguration() {
    setApiKey('');
    setBaseUrl('');
    setHeadersText('');
  }

  function changeProvider(next: ProviderKind) {
    clearDraftConfiguration();
    setProvider(next);
    setModel('');
    setModels([]);
    setError('');
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && busy) return;
    if (!nextOpen) {
      clearDraftConfiguration();
      setModels([]);
      setError('');
    }
    onOpenChange(nextOpen);
  }

  async function configure() {
    setBusy(true);
    setError('');
    try {
      if (provider === 'chatgpt') {
        const discovered = await api.models(provider);
        setModels(discovered.models);
        if (!model && discovered.models[0]) setModel(discovered.models[0].id);
        return;
      }
      let headers: Record<string, string> | undefined;
      if (headersText.trim()) {
        const parsed = JSON.parse(headersText) as unknown;
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          Object.values(parsed).some((value) => typeof value !== 'string')
        ) {
          throw new Error('Custom headers must be a JSON object with string values.');
        }
        headers = parsed as Record<string, string>;
      }
      const state =
        currentState?.configured && !hasDraftConfiguration
          ? currentState
          : await api.configureProvider(provider, {
              ...(apiKey ? { apiKey } : {}),
              ...((provider === 'openai-compatible' || provider === 'ollama') && endpointToSubmit
                ? { baseUrl: endpointToSubmit }
                : {}),
              ...(headers ? { headers } : {}),
            });
      clearDraftConfiguration();
      setStates((current) => [...current.filter((item) => item.provider !== provider), state]);
      const discovered = await api.models(provider);
      setModels(discovered.models);
      if (!model && discovered.models[0]) setModel(discovered.models[0].id);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  async function connectChatGpt(clientId?: string) {
    const browser = window.open('about:blank', '_blank');
    setBusy(true);
    setError('');
    try {
      const { url } = await api.connectChatGpt(clientId);
      if (browser) browser.location.replace(url);
      else window.location.assign(url);
    } catch (reason) {
      browser?.close();
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  async function signOutChatGpt() {
    setBusy(true);
    setError('');
    try {
      const result = await api.signOutChatGpt();
      const refreshed = await api.providerStates();
      setStates(refreshed.providers);
      setModels([]);
      setModel('');
      if (!result.revocationConfirmed) {
        setError(
          'Signed out locally. Remote revocation could not be confirmed; disconnect PRD Genie in ChatGPT Settings if needed.',
        );
      }
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  async function clearSessionCredential() {
    setBusy(true);
    setError('');
    try {
      await api.clearProvider(provider);
      clearDraftConfiguration();
      const result = await api.providerStates();
      setStates(result.providers);
      setModels([]);
      setModel('');
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveSelection() {
    if (hasDraftConfiguration) {
      setError('Configure the pending session settings before using this provider.');
      return;
    }
    if (!model.trim()) {
      setError('Choose a model or enter a model ID.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await api.updateProject(project.id, {
        selectedProvider: provider,
        selectedModel: model.trim(),
      });
      onProjectChange(updated);
      onOpenChange(false);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="provider-dialog" showCloseButton={!busy} aria-busy={busy}>
        <DialogHeader>
          <DialogTitle>Model provider</DialogTitle>
          <DialogDescription>
            API keys stay in server memory for this browser session. ChatGPT connection credentials
            are stored locally with owner-only access so you can reconnect after restart.
          </DialogDescription>
        </DialogHeader>

        <div className="provider-disclosure" role="note">
          <ShieldCheck aria-hidden="true" />
          <div>
            <strong>Before first use</strong>
            <p>
              PRD scope, your instruction, and up to eight retrieved source excerpts are sent to the
              selected provider. Keys are never written to the project database or browser storage.
            </p>
          </div>
        </div>

        <label className="field">
          <span>Provider</span>
          <select
            value={provider}
            disabled={busy || statesLoading}
            onChange={(event) => changeProvider(event.target.value as ProviderKind)}
          >
            {Object.entries(providerLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {provider === 'chatgpt' && (
          <div className="provider-disclosure" role="status">
            <ShieldCheck aria-hidden="true" />
            <div>
              <strong>
                {currentState?.configured
                  ? 'ChatGPT plan ready'
                  : currentState?.pending
                    ? 'Complete sign-in in your browser'
                    : currentState?.connected
                      ? 'ChatGPT connected · plan use not enabled'
                      : 'ChatGPT plan not connected'}
              </strong>
              <p>
                {currentState?.account ? `Selected account: ${currentState.account}. ` : ''}ChatGPT
                plan use is optional and online. Eligible accounts and models are decided by OpenAI.
                This does not create a PRD Genie account or use an API key.
              </p>
              <div className="provider-actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || currentState?.pending}
                  onClick={() => void connectChatGpt(currentState?.activeClientId ?? undefined)}
                >
                  {currentState?.connected && !currentState.configured
                    ? 'Enable ChatGPT plan use'
                    : 'Continue with ChatGPT'}
                </Button>
                {currentState?.accounts && currentState.accounts.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || currentState.pending}
                    onClick={() => void connectChatGpt()}
                  >
                    Add another account
                  </Button>
                )}
                {currentState?.connected && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void signOutChatGpt()}
                  >
                    Sign out
                  </Button>
                )}
              </div>
              {currentState?.accounts && currentState.accounts.length > 0 && (
                <label className="field">
                  <span>Saved ChatGPT account</span>
                  <select
                    value={currentState.activeClientId ?? ''}
                    disabled={busy}
                    onChange={(event) => {
                      const selected = currentState.accounts?.find(
                        (item) => item.clientId === event.target.value,
                      );
                      if (!selected?.connected) {
                        void connectChatGpt(event.target.value);
                        return;
                      }
                      void api
                        .selectChatGpt(event.target.value)
                        .then(() => api.providerStates())
                        .then(({ providers }) => {
                          setStates(providers);
                          setModels([]);
                          setModel('');
                        })
                        .catch((reason: unknown) => setError(messageFrom(reason)));
                    }}
                  >
                    <option value="" disabled>
                      Choose an account
                    </option>
                    {currentState.accounts.map((item) => (
                      <option key={item.clientId} value={item.clientId}>
                        {item.email ?? item.clientId}
                        {item.connected ? '' : ' · reconnect'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {currentState?.error && (
                <p className="form-error" role="alert">
                  {currentState.error}
                </p>
              )}
              <a
                href="https://chatgpt.com/settings/usage"
                target="_blank"
                rel="noopener noreferrer"
              >
                View ChatGPT usage and access
              </a>
            </div>
          </div>
        )}

        {(provider === 'openai-compatible' || provider === 'ollama') && (
          <label className="field">
            <span>Endpoint</span>
            <Input
              value={baseUrl}
              disabled={busy}
              placeholder={
                provider === 'ollama'
                  ? 'http://127.0.0.1:11434/v1'
                  : 'https://models.example.com/v1'
              }
              onChange={(event) => setBaseUrl(event.target.value)}
              autoComplete="off"
            />
          </label>
        )}

        {provider !== 'ollama' && provider !== 'chatgpt' && (
          <label className="field">
            <span>Session key</span>
            <div className="key-field">
              <KeyRound aria-hidden="true" />
              <Input
                type="password"
                value={apiKey}
                disabled={busy}
                placeholder={
                  currentState?.credentialSource === 'environment'
                    ? 'Environment fallback available'
                    : 'Paste key for this session'
                }
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </label>
        )}

        {provider === 'openai-compatible' && (
          <label className="field">
            <span>Optional headers as JSON</span>
            <textarea
              value={headersText}
              disabled={busy}
              placeholder='{"X-Provider-Team":"team-id"}'
              onChange={(event) => setHeadersText(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}

        <div className="provider-host">
          Active outbound host: <code>{currentState?.baseUrl ?? 'Provider default'}</code>
        </div>

        {typedBaseUrl && (
          <div className="provider-host provider-host-pending">
            Pending endpoint host: <code>{displayHostname(typedBaseUrl)}</code>
          </div>
        )}

        {missingCompatibleEndpoint && currentState?.configured && (
          <p className="field-hint" role="note">
            Re-enter the full endpoint before replacing this session configuration.
          </p>
        )}

        <div className="provider-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={
              busy ||
              statesLoading ||
              (provider === 'chatgpt' && !currentState?.configured) ||
              (provider !== 'ollama' &&
                provider !== 'chatgpt' &&
                provider !== 'openai-compatible' &&
                !apiKey &&
                !currentState?.configured) ||
              missingCompatibleEndpoint
            }
            onClick={() => void configure()}
          >
            {busy ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <Check aria-hidden="true" />
            )}
            {currentState?.configured ? 'Refresh models' : 'Configure and discover'}
          </Button>
          {provider !== 'chatgpt' && currentState?.credentialSource === 'session' && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void clearSessionCredential()}
            >
              Clear session configuration
            </Button>
          )}
        </div>

        <div className="model-row">
          <ModelSelector>
            <ModelSelectorTrigger asChild>
              <Button type="button" variant="outline" className="model-trigger" disabled={busy}>
                <span>{model || 'Choose a model'}</span>
                <ChevronDown aria-hidden="true" />
              </Button>
            </ModelSelectorTrigger>
            <ModelSelectorContent title="Choose a model">
              <ModelSelectorInput placeholder="Search models" />
              <ModelSelectorList>
                <ModelSelectorEmpty>
                  {provider === 'chatgpt'
                    ? 'Connect ChatGPT and refresh the account model list.'
                    : 'No discovered models. Enter an ID below.'}
                </ModelSelectorEmpty>
                <ModelSelectorGroup heading={providerLabels[provider]}>
                  {models.map((item) => (
                    <ModelSelectorItem
                      key={item.id}
                      value={`${item.name} ${item.id}`}
                      onSelect={() => setModel(item.id)}
                    >
                      <ModelSelectorName>{item.name}</ModelSelectorName>
                      <code>{item.id}</code>
                    </ModelSelectorItem>
                  ))}
                </ModelSelectorGroup>
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelector>
          {provider !== 'chatgpt' && (
            <Input
              value={model}
              disabled={busy}
              placeholder="Or enter a model ID"
              onChange={(event) => setModel(event.target.value)}
              spellCheck={false}
            />
          )}
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              busy ||
              statesLoading ||
              hasDraftConfiguration ||
              !model.trim() ||
              (provider === 'chatgpt' && !currentState?.configured)
            }
            onClick={() => void saveSelection()}
          >
            Use provider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'The provider could not be configured.';
}

function displayHostname(value: string): string {
  try {
    return new URL(value).hostname || 'Invalid endpoint';
  } catch {
    return 'Invalid endpoint';
  }
}
