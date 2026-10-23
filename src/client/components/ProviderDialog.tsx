import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, KeyRound, LoaderCircle } from 'lucide-react';
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
import './provider-settings.css';
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

export function ProviderDialog(props: ProviderDialogProps) {
  return props.open ? <ProviderSettings {...props} /> : null;
}

function ProviderSettings({ open, project, onOpenChange, onProjectChange }: ProviderDialogProps) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const [provider, setProvider] = useState<ProviderKind>(project.selectedProvider ?? 'openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [states, setStates] = useState<ProviderState[]>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [model, setModel] = useState(project.selectedModel ?? '');
  const [busy, setBusy] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [stateError, setStateError] = useState('');
  const [notice, setNotice] = useState('');
  const [statesLoading, setStatesLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let current = true;
    void api
      .providerStates()
      .then(({ providers }) => {
        if (current) setStates(providers);
      })
      .catch((reason: unknown) => {
        if (current) setStateError(messageFrom(reason));
      })
      .finally(() => {
        if (current) setStatesLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open || provider !== 'chatgpt') return;
    let current = true;
    let fetching = false;
    const refresh = () => {
      if (fetching) return;
      fetching = true;
      void api
        .providerStates()
        .then(({ providers }) => {
          if (current) {
            setStates(providers);
            setStateError('');
          }
        })
        .catch((reason: unknown) => {
          if (current) setStateError(messageFrom(reason));
        })
        .finally(() => {
          fetching = false;
        });
    };
    const interval = window.setInterval(refresh, 1800);
    return () => {
      current = false;
      window.clearInterval(interval);
    };
  }, [open, provider]);

  async function refreshStates() {
    setStatesLoading(true);
    setStateError('');
    try {
      setStates((await api.providerStates()).providers);
    } catch (reason) {
      setStateError(messageFrom(reason));
    } finally {
      setStatesLoading(false);
    }
  }

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
    setNotice('');
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && busy) return;
    if (!nextOpen) {
      clearDraftConfiguration();
      setModels([]);
      setModelPickerOpen(false);
      setError('');
      setNotice('');
    }
    onOpenChange(nextOpen);
  }

  async function configure() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (provider === 'chatgpt') {
        const discovered = await api.models(provider);
        setModels(discovered.models);
        if (!model && discovered.models[0]) setModel(discovered.models[0].id);
        setNotice(
          discovered.models.length
            ? `${discovered.models.length} models available. Choose a model, then use it for this project.`
            : 'No models were returned by this provider.',
        );
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
      setNotice(
        discovered.models.length
          ? `${discovered.models.length} models available.`
          : 'No models were returned. You can enter a model ID below.',
      );
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
    setNotice('');
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

  async function cancelChatGpt() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.cancelChatGpt();
      setStates((await api.providerStates()).providers);
      setNotice('Sign-in cancelled. You can close the browser sign-in page.');
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  async function selectAccount(clientId: string) {
    const selected = currentState?.accounts?.find((item) => item.clientId === clientId);
    if (!selected?.connected) {
      await connectChatGpt(clientId);
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.selectChatGpt(clientId);
      setStates((await api.providerStates()).providers);
      setModels([]);
      setModel('');
      setNotice('Account selected. Refresh models to choose an available model.');
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  async function signOutChatGpt() {
    setBusy(true);
    setError('');
    setNotice('');
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
    setNotice('');
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
    setNotice('');
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

  const configuredHost = currentState?.baseUrl ?? null;
  const localEndpoint =
    configuredHost !== null &&
    ['localhost', '127.0.0.1', '::1', '[::1]'].includes(configuredHost.toLowerCase());
  const selectedForProject =
    project.selectedProvider === provider && project.selectedModel === model;
  const configurationLabel = statesLoading
    ? 'Checking configuration…'
    : stateError
      ? 'Configuration unavailable'
      : currentState?.configured
        ? 'Configured'
        : 'Setup needed';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="provider-dialog provider-settings-sheet"
        showCloseButton={!busy}
        aria-busy={busy}
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>AI settings</DialogTitle>
          <DialogDescription>
            Choose how this project uses AI. Editing, saving and exporting work without a
            connection.
          </DialogDescription>
        </DialogHeader>

        <div className="settings-body">
          <p className="settings-current">
            <span>Used by this project</span>
            <strong>
              {project.selectedProvider
                ? providerLabels[project.selectedProvider]
                : 'No provider selected'}
            </strong>
            {project.selectedModel && (
              <span className="settings-current-model">{project.selectedModel}</span>
            )}
          </p>

          <section className="settings-group" aria-labelledby="provider-heading">
            <h2 id="provider-heading">Provider</h2>
            <label className="field">
              <span>AI provider</span>
              <select
                value={provider}
                disabled={busy || statesLoading}
                onChange={(event) => changeProvider(event.target.value as ProviderKind)}
              >
                {Object.entries(providerLabels).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <p className="settings-readiness" role="status">
              {configurationLabel}
              {!statesLoading && !stateError && configuredHost
                ? ` · ${localEndpoint ? 'On this Mac' : 'Online'}`
                : ''}
              {selectedForProject && currentState?.configured ? ' · Selected for this project' : ''}
            </p>
            {stateError && (
              <div className="settings-error" role="alert">
                <p>{stateError}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={statesLoading || busy}
                  onClick={() => void refreshStates()}
                >
                  Retry configuration check
                </Button>
              </div>
            )}

            {provider === 'chatgpt' && (
              <div className="settings-connection">
                <h3>
                  {currentState?.pending
                    ? 'Finish connecting in your browser'
                    : currentState?.configured
                      ? 'ChatGPT connected'
                      : currentState?.connected
                        ? 'Enable access to your ChatGPT plan'
                        : 'Connect your ChatGPT plan'}
                </h3>
                <p>
                  Use an eligible ChatGPT subscription. This is optional, requires internet and does
                  not create a PRD Genie account. OpenAI determines available models and usage
                  limits.
                </p>
                {currentState?.account && (
                  <p className="settings-account">{currentState.account}</p>
                )}
                {currentState?.pending ? (
                  <>
                    <p role="status">
                      Return here after granting access. If you closed the browser or changed your
                      mind, cancel this attempt before trying again.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void cancelChatGpt()}
                    >
                      Cancel sign-in
                    </Button>
                  </>
                ) : (
                  <div className="provider-actions">
                    {(!currentState?.configured || currentState?.error) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy || statesLoading}
                        onClick={() =>
                          void connectChatGpt(currentState?.activeClientId ?? undefined)
                        }
                      >
                        {currentState?.connected && !currentState.configured
                          ? 'Enable ChatGPT plan use'
                          : currentState?.error
                            ? 'Reconnect ChatGPT'
                            : 'Continue with ChatGPT'}
                      </Button>
                    )}
                    {currentState?.accounts && currentState.accounts.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void connectChatGpt()}
                      >
                        Add another account
                      </Button>
                    )}
                    {currentState?.connected && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void signOutChatGpt()}
                      >
                        Sign out
                      </Button>
                    )}
                  </div>
                )}
                {currentState?.accounts && currentState.accounts.length > 0 && (
                  <label className="field">
                    <span>Saved ChatGPT account</span>
                    <select
                      value={currentState.activeClientId ?? ''}
                      disabled={busy || currentState.pending}
                      onChange={(event) => void selectAccount(event.target.value)}
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
                    {currentState.error} Your project and selected model have not been replaced.
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
                  spellCheck={false}
                />
              </label>
            )}
            {provider === 'ollama' && (
              <p className="settings-help">
                Start Ollama with a downloaded model before using AI. No model is bundled with PRD
                Genie.
              </p>
            )}
            {provider !== 'ollama' && provider !== 'chatgpt' && (
              <label className="field">
                <span>API key for this session</span>
                <div className="key-field">
                  <KeyRound aria-hidden="true" />
                  <Input
                    type="password"
                    value={apiKey}
                    disabled={busy}
                    placeholder={
                      currentState?.credentialSource === 'environment'
                        ? 'Environment configuration available'
                        : currentState?.configured
                          ? 'Leave empty to keep current key'
                          : 'Paste an API key'
                    }
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </label>
            )}
            {provider === 'openai-compatible' && (
              <details className="settings-advanced">
                <summary>Additional headers</summary>
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
              </details>
            )}
            <p className="provider-host">
              {configuredHost ? (
                <>
                  Configured host: <code>{configuredHost}</code>
                </>
              ) : (
                'No endpoint configured.'
              )}
            </p>
            <p className="settings-help">
              AI requests include your instruction, the current PRD scope and retrieved source
              excerpts.{' '}
              {localEndpoint
                ? 'They go to the configured endpoint on this Mac.'
                : 'Check the provider and destination before sending private material.'}
            </p>
            {typedBaseUrl && (
              <p className="provider-host">
                Pending endpoint host: <code>{displayHostname(typedBaseUrl)}</code>
              </p>
            )}
            {missingCompatibleEndpoint && currentState?.configured && (
              <p className="settings-help">
                Re-enter the full endpoint before replacing this session configuration.
              </p>
            )}
          </section>

          <section className="settings-group" aria-labelledby="model-heading">
            <div className="settings-section-heading">
              <h2 id="model-heading">Model</h2>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={
                  busy ||
                  statesLoading ||
                  Boolean(stateError) ||
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
                {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
                {hasDraftConfiguration || !currentState?.configured
                  ? 'Configure and discover'
                  : 'Refresh models'}
              </Button>
            </div>
            <div className="model-row">
              <ModelSelector open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
                <ModelSelectorTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="model-trigger"
                    disabled={busy || statesLoading}
                    aria-label={model ? `Choose model, current choice ${model}` : 'Choose a model'}
                  >
                    <span>{model || 'Choose a model'}</span>
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </ModelSelectorTrigger>
                <ModelSelectorContent
                  title="Choose a model"
                  className="provider-model-picker"
                  aria-describedby={undefined}
                >
                  <ModelSelectorInput placeholder="Search models" aria-label="Search models" />
                  <ModelSelectorList>
                    <ModelSelectorEmpty>
                      {models.length
                        ? 'No matching models.'
                        : provider === 'chatgpt'
                          ? 'Connect ChatGPT, then refresh models in AI settings.'
                          : 'Refresh models in AI settings, or enter an ID there.'}
                    </ModelSelectorEmpty>
                    <ModelSelectorGroup heading={providerLabels[provider]}>
                      {models.map((item) => (
                        <ModelSelectorItem
                          key={item.id}
                          value={`${item.name} ${item.id}`}
                          onSelect={() => {
                            setModel(item.id);
                            setModelPickerOpen(false);
                          }}
                        >
                          <ModelSelectorName>{item.name}</ModelSelectorName>
                          {model === item.id && <Check aria-hidden="true" />}
                          <code>{item.id}</code>
                        </ModelSelectorItem>
                      ))}
                    </ModelSelectorGroup>
                  </ModelSelectorList>
                </ModelSelectorContent>
              </ModelSelector>
              {provider !== 'chatgpt' && (
                <label className="field">
                  <span>Or enter a model ID</span>
                  <Input
                    value={model}
                    disabled={busy}
                    placeholder="Model ID"
                    onChange={(event) => setModel(event.target.value)}
                    spellCheck={false}
                  />
                </label>
              )}
            </div>
            <p className="settings-help">
              The selected model is used as chosen. PRD Genie does not switch providers or fall back
              to paid API usage.
            </p>
            {notice && (
              <p className="settings-notice" role="status">
                {notice}
              </p>
            )}
          </section>

          <details className="settings-privacy">
            <summary>Data and credentials</summary>
            <p>
              {!configuredHost
                ? 'Requests use the endpoint you configure.'
                : localEndpoint
                  ? 'Requests go to the configured local endpoint on this Mac.'
                  : 'Requests go to the configured provider online.'}{' '}
              Your instruction, selected PRD scope and up to eight retrieved source excerpts are
              included. Review source extraction warnings before asking AI to use material.
            </p>
            <p>
              API keys stay in server memory for this session. ChatGPT credentials are stored
              locally with owner-only access to reconnect after restart. Neither is stored in
              project documents.
            </p>
            {provider !== 'chatgpt' && currentState?.credentialSource === 'session' && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void clearSessionCredential()}
              >
                Clear session configuration
              </Button>
            )}
          </details>
          {error && (
            <p className="form-error settings-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              busy ||
              statesLoading ||
              Boolean(stateError) ||
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
