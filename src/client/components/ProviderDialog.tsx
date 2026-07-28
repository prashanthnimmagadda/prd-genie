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
  const [states, setStates] = useState<ProviderState[]>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [model, setModel] = useState(project.selectedModel ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    void api
      .providerStates()
      .then(({ providers }) => setStates(providers))
      .catch((reason: unknown) => setError(messageFrom(reason)));
  }, [open]);

  const currentState = states.find((state) => state.provider === provider);
  const endpoint =
    baseUrl ||
    (provider === 'ollama'
      ? 'http://127.0.0.1:11434/v1'
      : provider === 'openai-compatible'
        ? ''
        : undefined);

  async function configure() {
    setBusy(true);
    setError('');
    try {
      const state = await api.configureProvider(provider, {
        ...(apiKey ? { apiKey } : {}),
        ...(endpoint ? { baseUrl: endpoint } : {}),
      });
      setApiKey('');
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

  async function saveSelection() {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="provider-dialog">
        <DialogHeader>
          <DialogTitle>Model provider</DialogTitle>
          <DialogDescription>
            Credentials stay in server memory for this browser session and expire after eight idle
            hours.
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
            onChange={(event) => {
              const next = event.target.value as ProviderKind;
              setProvider(next);
              setModel('');
              setModels([]);
              setError('');
            }}
          >
            {Object.entries(providerLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {(provider === 'openai-compatible' || provider === 'ollama') && (
          <label className="field">
            <span>Endpoint</span>
            <Input
              value={baseUrl}
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

        {provider !== 'ollama' && (
          <label className="field">
            <span>Session key</span>
            <div className="key-field">
              <KeyRound aria-hidden="true" />
              <Input
                type="password"
                value={apiKey}
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

        <div className="provider-host">
          Outbound host: <code>{currentState?.baseUrl ?? endpoint ?? 'Provider default'}</code>
        </div>

        <div className="provider-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={busy || (provider !== 'ollama' && !apiKey && !currentState?.configured)}
            onClick={() => void configure()}
          >
            {busy ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <Check aria-hidden="true" />
            )}
            {currentState?.configured ? 'Refresh models' : 'Configure and discover'}
          </Button>
        </div>

        <div className="model-row">
          <ModelSelector>
            <ModelSelectorTrigger asChild>
              <Button type="button" variant="outline" className="model-trigger">
                <span>{model || 'Choose a model'}</span>
                <ChevronDown aria-hidden="true" />
              </Button>
            </ModelSelectorTrigger>
            <ModelSelectorContent title="Choose a model">
              <ModelSelectorInput placeholder="Search models" />
              <ModelSelectorList>
                <ModelSelectorEmpty>No discovered models. Enter an ID below.</ModelSelectorEmpty>
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
          <Input
            value={model}
            placeholder="Or enter a model ID"
            onChange={(event) => setModel(event.target.value)}
            spellCheck={false}
          />
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !model.trim()}
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
