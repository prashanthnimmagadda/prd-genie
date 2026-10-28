import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { ProjectSummary, ProviderKind, ProviderState } from '@shared/types';
import { api } from '@/lib/api';
import { isLocalProvider, providerLabels } from '@/lib/provider-display';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface ModelGroup {
  state: ProviderState;
  models: Array<{ id: string; name: string }>;
  error?: string;
  loading?: boolean;
}

export function ConnectedModelPicker({
  project,
  activeState,
  disabled,
  open,
  onOpenChange,
  onProjectChange,
}: {
  project: ProjectSummary;
  activeState: ProviderState | null;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectChange: (project: ProjectSummary) => void;
}) {
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const savingRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    let current = true;
    void api
      .providerStates()
      .then(({ providers }) => {
        if (!current) return;
        const configured = providers.filter((state) => state.configured);
        setGroups(configured.map((state) => ({ state, models: [], loading: true })));
        setLoading(false);
        for (const state of configured) {
          void api
            .models(state.provider)
            .then(({ models }) => {
              if (current)
                setGroups((groups) =>
                  groups.map((group) =>
                    group.state.provider === state.provider ? { state, models } : group,
                  ),
                );
            })
            .catch((reason: unknown) => {
              if (current)
                setGroups((groups) =>
                  groups.map((group) =>
                    group.state.provider === state.provider
                      ? {
                          state,
                          models: [],
                          error: reason instanceof Error ? reason.message : 'Models unavailable.',
                        }
                      : group,
                  ),
                );
            });
        }
      })
      .catch((reason: unknown) => {
        if (current)
          setError(reason instanceof Error ? reason.message : 'Connections unavailable.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open]);

  async function choose(provider: ProviderKind, model: string) {
    if (savingRef.current || disabled) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateProject(project.id, {
        selectedProvider: provider,
        selectedModel: model,
      });
      onProjectChange(updated);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Model selection could not be saved.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        size="sm"
        className="composer-model"
        aria-label="Choose connected model"
        disabled={disabled}
        onClick={() => {
          setLoading(true);
          setGroups([]);
          setError('');
          onOpenChange(true);
        }}
      >
        <span>
          {project.selectedModel
            ? `${activeState ? (isLocalProvider(activeState) ? 'Local' : 'Online') : 'Model'} · ${project.selectedModel}`
            : 'Choose model'}
        </span>
        <ChevronDown aria-hidden="true" />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!saving) onOpenChange(next);
        }}
      >
        <DialogContent
          className="connected-model-dialog"
          showCloseButton={!saving}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogTitle>Connected models</DialogTitle>
          <DialogDescription>
            Choose a model for this project. No document is sent until you submit an instruction.
            Add or configure connections in AI settings in the sidebar.
          </DialogDescription>
          {loading && <p role="status">Loading available models…</p>}
          {error && <p role="alert">{error}</p>}
          {!loading && !error && groups.length === 0 && (
            <p>
              No connections are configured. For Bonsai or another local server, choose Local /
              OpenAI-compatible in AI settings.
            </p>
          )}
          <div className="connected-model-list">
            {groups.map(({ state, models, error: groupError, loading: groupLoading }) => (
              <section key={state.provider} aria-label={providerLabels[state.provider]}>
                <h3>
                  {providerLabels[state.provider]}{' '}
                  <small>
                    {isLocalProvider(state) ? 'On this Mac' : (state.baseUrl ?? 'Online')}
                  </small>
                </h3>
                {groupLoading ? (
                  <p role="status">Loading models…</p>
                ) : groupError ? (
                  <p role="status">{groupError}</p>
                ) : models.length === 0 ? (
                  <p>No models returned. Check this connection in AI settings.</p>
                ) : (
                  models.map((model) => (
                    <button
                      type="button"
                      key={model.id}
                      disabled={disabled || saving}
                      aria-pressed={
                        project.selectedProvider === state.provider &&
                        project.selectedModel === model.id
                      }
                      onClick={() => void choose(state.provider, model.id)}
                    >
                      <span>
                        {model.name}
                        <small>{model.name !== model.id ? model.id : ''}</small>
                      </span>
                      {project.selectedProvider === state.provider &&
                        project.selectedModel === model.id && <Check aria-hidden="true" />}
                    </button>
                  ))
                )}
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
