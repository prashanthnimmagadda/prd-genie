import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { ProjectSummary, ProviderKind, ProviderState } from '@shared/types';
import { api } from '@/lib/api';
import { formatTime, messageFrom } from '@/lib/format';
import {
  defaultHost,
  localProviders,
  onlineProviders,
  providerIsLocal,
  providerLabels,
  providerStatus,
} from '@/lib/provider-display';

interface SettingsViewProps {
  project: ProjectSummary;
  offline: boolean;
  disabled: boolean;
  initialProvider: ProviderKind | null;
  onProjectChange: (project: ProjectSummary) => void;
  onStatesChange: (states: ProviderState[]) => void;
}

export function SettingsView({
  project,
  offline,
  disabled,
  initialProvider,
  onProjectChange,
  onStatesChange,
}: SettingsViewProps) {
  const [provider, setProvider] = useState<ProviderKind>(initialProvider ?? 'anthropic');
  const [states, setStates] = useState<ProviderState[]>([]);
  const [statesLoading, setStatesLoading] = useState(true);
  const [stateError, setStateError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [model, setModel] = useState(
    project.selectedProvider === (initialProvider ?? 'anthropic')
      ? (project.selectedModel ?? '')
      : '',
  );
  const [checkedAt, setCheckedAt] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const publish = useRef(onStatesChange);
  useEffect(() => {
    publish.current = onStatesChange;
  }, [onStatesChange]);

  function applyStates(next: ProviderState[]) {
    setStates(next);
    publish.current(next);
  }

  useEffect(() => {
    let current = true;
    void api
      .providerStates()
      .then(({ providers }) => {
        if (current) applyStates(providers);
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
  }, []);

  useEffect(() => {
    if (provider !== 'chatgpt') return;
    let current = true;
    let fetching = false;
    const interval = window.setInterval(() => {
      if (fetching) return;
      fetching = true;
      void api
        .providerStates()
        .then(({ providers }) => {
          if (current) {
            applyStates(providers);
            setStateError('');
          }
        })
        .catch((reason: unknown) => {
          if (current) setStateError(messageFrom(reason));
        })
        .finally(() => {
          fetching = false;
        });
    }, 1800);
    return () => {
      current = false;
      window.clearInterval(interval);
    };
  }, [provider]);

  const currentState = states.find((state) => state.provider === provider);
  const typedBaseUrl = baseUrl.trim();
  const hasDraft = Boolean(apiKey || typedBaseUrl || headersText.trim());
  const missingCompatibleEndpoint =
    provider === 'openai-compatible' && (!currentState?.configured || hasDraft) && !typedBaseUrl;
  const local = providerIsLocal(provider, currentState);
  const host = currentState?.baseUrl ?? defaultHost(provider);
  const status = providerStatus(provider, currentState, offline);
  const label = providerLabels[provider];
  const inUse = project.selectedProvider === provider;

  function clearDraft() {
    setApiKey('');
    setBaseUrl('');
    setHeadersText('');
  }

  function changeProvider(next: ProviderKind) {
    if (busy) return;
    clearDraft();
    setProvider(next);
    setModels([]);
    setModel(project.selectedProvider === next ? (project.selectedModel ?? '') : '');
    setError('');
    setNotice('');
  }

  async function check() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
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
      if (provider !== 'chatgpt' && (!currentState?.configured || hasDraft)) {
        const state = await api.configureProvider(provider, {
          ...(apiKey ? { apiKey } : {}),
          ...((provider === 'openai-compatible' || provider === 'ollama') && typedBaseUrl
            ? { baseUrl: typedBaseUrl }
            : {}),
          ...(headers ? { headers } : {}),
        });
        clearDraft();
        applyStates([...states.filter((item) => item.provider !== provider), state]);
      }
      const discovered = await api.models(provider);
      setModels(discovered.models);
      if (!model && discovered.models[0]) setModel(discovered.models[0].id);
      setCheckedAt((current) => ({ ...current, [provider]: new Date().toISOString() }));
      setNotice(
        discovered.models.length
          ? ''
          : provider === 'chatgpt'
            ? 'No models were returned by ChatGPT.'
            : 'No models were listed. Enter a model name below.',
      );
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  async function removeCredential() {
    setBusy(true);
    setError('');
    try {
      await api.clearProvider(provider);
      clearDraft();
      applyStates((await api.providerStates()).providers);
      setModels([]);
      setModel('');
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  async function chooseForProject() {
    if (hasDraft) {
      setError('Check the pending settings before using this provider.');
      return;
    }
    if (!model.trim()) {
      setError('Choose a model or enter a model name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Saves the choice only. Nothing is sent until you press Send.
      const updated = await api.updateProject(project.id, {
        selectedProvider: provider,
        selectedModel: model.trim(),
      });
      onProjectChange(updated);
      setNotice(`${model.trim()} is in use for this project.`);
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

  async function chatGptAction(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await operation();
      applyStates((await api.providerStates()).providers);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  const checkLabel = busy
    ? 'Checking…'
    : provider === 'chatgpt'
      ? 'Check models'
      : currentState?.configured && !hasDraft
        ? 'Check again'
        : provider === 'ollama' || provider === 'openai-compatible'
          ? 'Check connection'
          : 'Check key';
  const checkDisabled =
    busy ||
    statesLoading ||
    disabled ||
    Boolean(stateError) ||
    (provider === 'chatgpt' && !currentState?.configured) ||
    (!['ollama', 'chatgpt', 'openai-compatible'].includes(provider) &&
      !apiKey &&
      !currentState?.configured) ||
    missingCompatibleEndpoint;
  const checked = checkedAt[provider];

  function renderRow(kind: ProviderKind) {
    const state = states.find((item) => item.provider === kind);
    const rowStatus = providerStatus(kind, state, offline);
    return (
      <button
        key={kind}
        type="button"
        role="option"
        aria-selected={kind === provider}
        className="list-row"
        disabled={busy}
        onClick={() => changeProvider(kind)}
      >
        <div>
          <span className="title">{providerLabels[kind]}</span>
          <span
            className={`sub ${rowStatus.tone === 'ok' ? 'success' : rowStatus.tone === 'warning' ? 'warning' : ''}`}
          >
            {statesLoading ? 'Checking…' : rowStatus.text}
          </span>
        </div>
      </button>
    );
  }

  return (
    <div className="split">
      <div className="split-list" role="listbox" aria-label="Providers" style={{ width: 300 }}>
        <span className="t-label">Online</span>
        {onlineProviders.map(renderRow)}
        <span className="t-label group-gap">On this Mac</span>
        {localProviders.map(renderRow)}
        {stateError && (
          <p
            className="t-secondary"
            role="alert"
            style={{ padding: '12px 12px 0', color: 'var(--danger)' }}
          >
            {stateError}
          </p>
        )}
      </div>
      <div className="split-detail" aria-busy={busy}>
        <div className="split-detail-inner" style={{ maxWidth: 620, gap: 24 }}>
          <div className="detail-title">
            <h2>{label}</h2>
            <span className="t-secondary provider-host">
              {local ? 'On this Mac' : 'Online'}
              {host ? ` · requests go to ${host}` : ' · no endpoint configured'}
              {inUse && project.selectedModel ? ` · In use: ${project.selectedModel}` : ''}
            </span>
          </div>

          {provider === 'chatgpt' ? (
            <div className="form-group">
              <span className="label">ChatGPT plan</span>
              <p className="t-secondary">
                Uses your ChatGPT plan. This is not a PRD Genie account and needs no API key.
              </p>
              {currentState?.account && <span>{currentState.account}</span>}
              {currentState?.pending ? (
                <div className="form-inline">
                  <span className="t-secondary" role="status">
                    Finish signing in in your browser, then return here.
                  </span>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void chatGptAction(() => api.cancelChatGpt())}
                  >
                    Cancel sign-in
                  </button>
                </div>
              ) : (
                <div className="form-inline" style={{ flexWrap: 'wrap' }}>
                  {(!currentState?.configured || currentState?.error) && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || statesLoading || disabled}
                      onClick={() => void connectChatGpt(currentState?.activeClientId ?? undefined)}
                    >
                      {currentState?.error ? 'Sign in again…' : 'Sign in with ChatGPT…'}
                    </button>
                  )}
                  {currentState?.accounts && currentState.accounts.length > 0 && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void connectChatGpt()}
                    >
                      Add another account…
                    </button>
                  )}
                  {currentState?.connected && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void chatGptAction(async () => {
                          const result = await api.signOutChatGpt();
                          setModels([]);
                          setModel('');
                          if (!result.revocationConfirmed)
                            setError(
                              'Signed out locally. Remote revocation could not be confirmed; disconnect PRD Genie in ChatGPT Settings if needed.',
                            );
                        })
                      }
                    >
                      Sign out
                    </button>
                  )}
                </div>
              )}
              {currentState?.accounts && currentState.accounts.length > 0 && (
                <label className="form-group">
                  <span className="label">Account</span>
                  <select
                    className="field"
                    value={currentState.activeClientId ?? ''}
                    disabled={busy || currentState.pending}
                    onChange={(event) => {
                      const selected = currentState.accounts?.find(
                        (item) => item.clientId === event.target.value,
                      );
                      if (!selected?.connected) void connectChatGpt(event.target.value);
                      else void chatGptAction(() => api.selectChatGpt(event.target.value));
                    }}
                  >
                    <option value="" disabled>
                      Choose an account
                    </option>
                    {currentState.accounts.map((item) => (
                      <option key={item.clientId} value={item.clientId}>
                        {item.email ?? item.clientId}
                        {item.connected ? '' : ' · sign in again'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {currentState?.error && (
                <p className="t-secondary" role="alert" style={{ color: 'var(--warning-text)' }}>
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
          ) : (
            <>
              {(provider === 'openai-compatible' || provider === 'ollama') && (
                <div className="form-group">
                  <label htmlFor="provider-endpoint">
                    {provider === 'ollama'
                      ? 'Host (default http://127.0.0.1:11434/v1)'
                      : 'Base URL'}
                  </label>
                  <input
                    id="provider-endpoint"
                    className="field"
                    value={baseUrl}
                    disabled={busy || disabled}
                    placeholder={
                      provider === 'ollama'
                        ? 'http://127.0.0.1:11434/v1'
                        : 'http://127.0.0.1:18080/v1'
                    }
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                  {typedBaseUrl && (
                    <span className="t-secondary provider-host">
                      Pending host: {displayHostname(typedBaseUrl)}
                    </span>
                  )}
                  {missingCompatibleEndpoint && currentState?.configured && (
                    <span className="t-secondary">
                      Re-enter the full endpoint before replacing this session configuration.
                    </span>
                  )}
                  {provider === 'ollama' && (
                    <span className="t-secondary">
                      Ollama runs on this Mac. Start it with an installed model before you send.
                    </span>
                  )}
                </div>
              )}
              {provider !== 'ollama' && (
                <div className="form-group">
                  <label htmlFor="provider-key">
                    {provider === 'openai-compatible' ? 'API key (optional)' : 'API key'}
                  </label>
                  <div className="form-inline">
                    <input
                      id="provider-key"
                      className="field"
                      type="password"
                      value={apiKey}
                      disabled={busy || disabled}
                      placeholder={
                        currentState?.credentialSource === 'environment'
                          ? 'Environment key in use'
                          : currentState?.configured
                            ? '••••••••••••••••••••'
                            : 'Paste an API key'
                      }
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                    {currentState?.credentialSource === 'session' && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => void removeCredential()}
                      >
                        Remove key
                      </button>
                    )}
                  </div>
                  <span className="t-secondary">
                    Kept in memory for this session only. You’ll enter it again after you quit PRD
                    Genie.
                  </span>
                </div>
              )}
              {provider === 'ollama' && currentState?.credentialSource === 'session' && (
                <button
                  type="button"
                  className="btn"
                  style={{ alignSelf: 'flex-start' }}
                  disabled={busy}
                  onClick={() => void removeCredential()}
                >
                  Remove endpoint
                </button>
              )}
              {provider === 'openai-compatible' && (
                <details>
                  <summary className="t-secondary">Additional headers</summary>
                  <label className="form-group" style={{ marginTop: 8 }}>
                    <span className="label">Optional headers as JSON</span>
                    <textarea
                      className="field"
                      value={headersText}
                      disabled={busy || disabled}
                      placeholder='{"X-Provider-Team":"team-id"}'
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setHeadersText(event.target.value)}
                    />
                  </label>
                </details>
              )}
            </>
          )}

          <div className="form-group">
            <span className="status-line" role="status">
              <span
                className={`dot ${status.tone === 'ok' ? 'ready' : status.tone === 'warning' ? 'warn' : 'off'}`}
                aria-hidden="true"
              />
              <span className={status.tone === 'ok' ? 'ok' : ''}>
                {statesLoading ? 'Checking…' : status.text}
              </span>
              {checked && <span className="t-secondary">· checked at {formatTime(checked)}</span>}
              <button
                type="button"
                className="btn-link"
                disabled={checkDisabled}
                onClick={() => void check()}
              >
                {busy && (
                  <LoaderCircle
                    className="spin"
                    aria-hidden="true"
                    style={{ width: 12, height: 12 }}
                  />
                )}
                {checkLabel}
              </button>
            </span>
          </div>

          <div className="form-group">
            <span className="label">Models</span>
            {models.length > 0 ? (
              <div className="model-list" role="radiogroup" aria-label={`${label} models`}>
                {models.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={model === item.id}
                    disabled={busy}
                    onClick={() => setModel(item.id)}
                  >
                    <span className="radio" aria-hidden="true" />
                    <span className="name">{item.name}</span>
                    {item.name !== item.id && <code>{item.id}</code>}
                    {inUse && project.selectedModel === item.id && (
                      <span className="tag">In use</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <span className="t-secondary">
                {provider === 'chatgpt'
                  ? 'Sign in, then check models to list what your plan offers.'
                  : `Press ${checkLabel} to list models, or enter a model name.`}
              </span>
            )}
            {provider !== 'chatgpt' && (
              <label className="form-group" style={{ gap: 4 }}>
                <span className="t-secondary">Model name</span>
                <input
                  className="field"
                  value={model}
                  disabled={busy || disabled}
                  placeholder="Model name"
                  spellCheck={false}
                  onChange={(event) => setModel(event.target.value)}
                />
              </label>
            )}
            <div className="form-inline">
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busy ||
                  disabled ||
                  statesLoading ||
                  Boolean(stateError) ||
                  hasDraft ||
                  !model.trim() ||
                  (provider === 'chatgpt' && !currentState?.configured) ||
                  (inUse && project.selectedModel === model.trim())
                }
                onClick={() => void chooseForProject()}
              >
                {inUse && project.selectedModel === model.trim()
                  ? 'In use for this project'
                  : 'Use for this project'}
              </button>
            </div>
            {notice && (
              <span className="t-secondary" role="status">
                {notice}
              </span>
            )}
            {error && (
              <span className="t-secondary" role="alert" style={{ color: 'var(--danger)' }}>
                {error}
              </span>
            )}
          </div>

          <div className="info-box">
            <strong>What is sent when you press Send</strong>
            <ul>
              <li>Your instruction</li>
              <li>The PRD scope you choose: Whole PRD, one section or a selection</li>
              <li>Up to 8 excerpts retrieved from Sources</li>
            </ul>
            <p>
              {provider === 'chatgpt'
                ? 'Sent only to chatgpt.com and counted against the ChatGPT plan you signed in with. '
                : local
                  ? `Sent only to ${host ?? 'the endpoint you configure'} on this Mac. `
                  : `Sent only to ${host ?? 'the endpoint you configure'} and billed by ${label} to the account that owns this key. `}
              Choosing a model sends nothing. If {label} fails, the request stops. PRD Genie never
              switches provider or model for you.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function displayHostname(value: string): string {
  try {
    return new URL(value).hostname || 'Invalid endpoint';
  } catch {
    return 'Invalid endpoint';
  }
}
