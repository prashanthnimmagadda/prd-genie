import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Laptop,
  LoaderCircle,
  ScanText,
  Square,
  TextSelect,
} from 'lucide-react';
import type {
  ActionScope,
  PrdSection,
  ProjectSummary,
  ProviderKind,
  ProviderState,
} from '@shared/types';
import { api } from '@/lib/api';
import {
  localProviders,
  onlineProviders,
  providerIsLocal,
  providerLabels,
  providerStatus,
} from '@/lib/provider-display';
import { messageFrom, sectionNumber } from '@/lib/format';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
  offline: boolean;
  placeholder: string;
  runningStatus?: string;
  scope: ActionScope;
  targetSectionId: string | null;
  selection: string;
  sections: PrdSection[];
  onScopeChange: (scope: ActionScope, targetSectionId: string | null) => void;
  project: ProjectSummary;
  activeState: ProviderState | null;
  onProjectChange: (project: ProjectSummary) => void;
  onOpenSettings: () => void;
  scopeMenuOpen: boolean;
  onScopeMenuOpenChange: (open: boolean) => void;
  modelMenuOpen: boolean;
  onModelMenuOpenChange: (open: boolean) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  compact?: boolean;
  reduceMotion?: boolean;
}

interface ModelGroup {
  provider: ProviderKind;
  state: ProviderState;
  models: Array<{ id: string; name: string }>;
  loading: boolean;
  error?: string;
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  disabled,
  offline,
  placeholder,
  runningStatus,
  scope,
  targetSectionId,
  selection,
  sections,
  onScopeChange,
  project,
  activeState,
  onProjectChange,
  onOpenSettings,
  scopeMenuOpen,
  onScopeMenuOpenChange,
  modelMenuOpen,
  onModelMenuOpenChange,
  textareaRef,
  compact = false,
  reduceMotion = false,
}: ComposerProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? localRef;
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [menuError, setMenuError] = useState('');
  const [menuLoading, setMenuLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(264, Math.max(compact ? 44 : 44, element.scrollHeight))}px`;
  }, [value, ref, compact]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    let current = true;
    void api
      .providerStates()
      .then(({ providers }) => {
        if (!current) return;
        const configured = providers.filter((state) => state.configured);
        setGroups(
          configured.map((state) => ({
            provider: state.provider,
            state,
            models: [],
            loading: true,
          })),
        );
        setMenuError('');
        setMenuLoading(false);
        for (const state of configured) {
          void api
            .models(state.provider)
            .then(({ models }) => {
              if (current)
                setGroups((items) =>
                  items.map((group) =>
                    group.provider === state.provider
                      ? { ...group, models, loading: false }
                      : group,
                  ),
                );
            })
            .catch((reason: unknown) => {
              if (current)
                setGroups((items) =>
                  items.map((group) =>
                    group.provider === state.provider
                      ? { ...group, loading: false, error: messageFrom(reason) }
                      : group,
                  ),
                );
            });
        }
      })
      .catch((reason: unknown) => {
        if (current) {
          setMenuError(messageFrom(reason));
          setMenuLoading(false);
        }
      });
    return () => {
      current = false;
    };
  }, [modelMenuOpen]);

  async function choose(provider: ProviderKind, model: string) {
    if (saving || disabled) return;
    setSaving(true);
    try {
      // Changes the selection only. Nothing is sent and no model is loaded.
      const updated = await api.updateProject(project.id, {
        selectedProvider: provider,
        selectedModel: model,
      });
      onProjectChange(updated);
    } catch (reason) {
      setMenuError(messageFrom(reason));
    } finally {
      setSaving(false);
    }
  }

  const modelChosen = Boolean(project.selectedProvider && project.selectedModel);
  const onlineBlocked =
    offline && !providerIsLocal(project.selectedProvider ?? 'openai', activeState);
  const canSend = !disabled && !busy && Boolean(value.trim()) && modelChosen && !onlineBlocked;
  const sendTitle = !modelChosen
    ? 'Choose a model to send'
    : onlineBlocked
      ? 'Online models are unavailable while offline'
      : undefined;
  const targetSection = sections.find((section) => section.id === targetSectionId);
  const scopeLabel =
    scope === 'document'
      ? 'Whole PRD'
      : scope === 'selection'
        ? 'Selection'
        : (targetSection?.title ?? 'Section');
  const activeStatus = project.selectedProvider
    ? providerStatus(project.selectedProvider, activeState, offline)
    : null;

  const orderedGroups = [
    ...onlineProviders.map((provider) => groups.find((group) => group.provider === provider)),
    ...localProviders.map((provider) => groups.find((group) => group.provider === provider)),
  ].filter((group): group is ModelGroup => Boolean(group));
  const onlineGroups = orderedGroups.filter(
    (group) => !providerIsLocal(group.provider, group.state),
  );
  const localGroups = orderedGroups.filter((group) => providerIsLocal(group.provider, group.state));

  function renderGroup(group: ModelGroup) {
    const status = providerStatus(group.provider, group.state, offline);
    const unavailable = status.tone === 'warning';
    const models = [...group.models];
    if (
      project.selectedProvider === group.provider &&
      project.selectedModel &&
      !models.some((model) => model.id === project.selectedModel)
    ) {
      models.unshift({ id: project.selectedModel, name: project.selectedModel });
    }
    const local = providerIsLocal(group.provider, group.state);
    return (
      <div
        key={group.provider}
        role="group"
        aria-label={
          local ? `On this Mac · ${providerLabels[group.provider]}` : providerLabels[group.provider]
        }
      >
        {group.loading && (
          <span className="menu-note" role="status">
            Loading models from {providerLabels[group.provider]}…
          </span>
        )}
        {group.error && <span className="menu-note">{group.error}</span>}
        {!group.loading && !group.error && models.length === 0 && (
          <span className="menu-note">No models listed by {providerLabels[group.provider]}.</span>
        )}
        {models.map((model) => {
          const selected =
            project.selectedProvider === group.provider && project.selectedModel === model.id;
          return (
            <DropdownMenuItem
              key={model.id}
              className="two-line"
              disabled={unavailable || saving}
              aria-checked={selected}
              role="menuitemradio"
              title={unavailable ? status.text : undefined}
              onSelect={() => void choose(group.provider, model.id)}
            >
              <span className="mark">{selected && <Check aria-hidden="true" />}</span>
              <div>
                <span className="truncate">{model.name}</span>
                <small>
                  {group.provider === 'ollama'
                    ? 'Installed · loads when you send'
                    : `${providerLabels[group.provider]} · ${status.text}`}
                </small>
              </div>
              {local && <Laptop className="laptop" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`composer ${compact ? 'compact' : ''}`}>
      {busy && (
        <p className="composer-running" role="status">
          {reduceMotion ? null : <LoaderCircle className="spin" aria-hidden="true" />}
          <span>{runningStatus || (reduceMotion ? 'Reading…' : 'Working…')}</span>
        </p>
      )}
      <textarea
        ref={ref}
        value={value}
        rows={2}
        aria-label="Your instruction"
        placeholder={busy ? 'You can keep typing; it sends after this finishes' : placeholder}
        maxLength={20000}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.stopPropagation();
            if (event.metaKey || event.ctrlKey) {
              event.preventDefault();
              if (value.trim() && modelChosen && !onlineBlocked) onSend(value);
            }
          }
        }}
      />
      <div className="composer-row">
        <DropdownMenu open={scopeMenuOpen} onOpenChange={onScopeMenuOpenChange} modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="chip"
              aria-label={`Apply to: ${scopeLabel}`}
              aria-keyshortcuts="Alt+Meta+A"
              disabled={disabled}
            >
              {scope === 'selection' ? (
                <TextSelect className="selection-icon" aria-hidden="true" />
              ) : (
                <ScanText aria-hidden="true" />
              )}
              <span className="label">{scopeLabel}</span>
              {scopeMenuOpen ? (
                <ChevronUp className="chev" aria-hidden="true" />
              ) : (
                <ChevronDown className="chev" aria-hidden="true" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="genie-menu"
            align="start"
            side="top"
            sideOffset={8}
            aria-label="Apply to"
            style={{ width: 300 }}
          >
            <DropdownMenuItem
              role="menuitemradio"
              aria-checked={scope === 'document'}
              onSelect={() => onScopeChange('document', null)}
            >
              <span className="mark">{scope === 'document' && <Check aria-hidden="true" />}</span>
              <span className="grow">Whole PRD</span>
              <span className="meta">{sections.length} sections</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              role="menuitemradio"
              className="two-line"
              aria-checked={scope === 'selection'}
              disabled={!selection.trim()}
              onSelect={() => onScopeChange('selection', targetSectionId)}
            >
              <span className="mark">{scope === 'selection' && <Check aria-hidden="true" />}</span>
              <div>
                <span>Selection</span>
                <small>
                  {selection.trim()
                    ? `${selection.trim().length} characters`
                    : 'Select text in Document first'}
                </small>
              </div>
            </DropdownMenuItem>
            <div className="menu-sep" role="separator" />
            <span className="menu-label indent">Section</span>
            {sections.map((section, index) => {
              const checked = scope === 'section' && targetSectionId === section.id;
              return (
                <DropdownMenuItem
                  key={section.id}
                  role="menuitemradio"
                  aria-checked={checked}
                  onSelect={() => onScopeChange('section', section.id)}
                >
                  <span className="mark">{checked && <Check aria-hidden="true" />}</span>
                  <span className="num">{sectionNumber(index)}</span>
                  <span className="grow" title={section.title}>
                    {section.title}
                  </span>
                  {!section.body.trim() && (
                    <span className={`tag ${section.required ? 'warning' : ''}`}>Empty</span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu open={modelMenuOpen} onOpenChange={onModelMenuOpenChange} modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="chip"
              aria-label={
                project.selectedModel
                  ? `Model: ${project.selectedModel}. Choose model`
                  : 'Choose model'
              }
              aria-keyshortcuts="Alt+Meta+M"
              disabled={disabled}
              title={project.selectedModel ?? undefined}
            >
              {project.selectedModel ? (
                <span
                  className={`dot ${activeStatus?.tone === 'ok' ? 'ready' : activeStatus?.tone === 'warning' ? 'warn' : 'off'}`}
                  aria-hidden="true"
                />
              ) : null}
              <span className="label">{project.selectedModel ?? 'Choose model'}</span>
              {modelMenuOpen ? (
                <ChevronUp className="chev" aria-hidden="true" />
              ) : (
                <ChevronDown className="chev" aria-hidden="true" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="genie-menu"
            align="start"
            side="top"
            sideOffset={8}
            aria-label="Model"
            style={{ width: 340 }}
          >
            {menuLoading && (
              <span className="menu-note" role="status">
                Checking connections…
              </span>
            )}
            {menuError && <span className="menu-note">{menuError}</span>}
            {!menuLoading && !menuError && groups.length === 0 && (
              <span className="menu-note">No provider is set up yet. Add one in AI settings.</span>
            )}
            {onlineGroups.length > 0 && <span className="menu-label">Online</span>}
            {onlineGroups.map(renderGroup)}
            {localGroups.length > 0 && <span className="menu-label">On this Mac</span>}
            {localGroups.map(renderGroup)}
            <div className="menu-sep" role="separator" />
            <DropdownMenuItem onSelect={onOpenSettings}>
              <span className="mark" />
              <span className="grow">AI settings…</span>
              <span className="shortcut" aria-hidden="true">
                ⌘,
              </span>
            </DropdownMenuItem>
            <span className="menu-note">Choosing a model sends nothing.</span>
          </DropdownMenuContent>
        </DropdownMenu>

        <span style={{ flex: 1 }} />
        {busy ? (
          <button type="button" className="send stop" aria-label="Stop" onClick={onStop}>
            <Square aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="send"
            aria-label="Send"
            aria-keyshortcuts="Meta+Enter"
            data-ready={canSend}
            disabled={disabled || !modelChosen || onlineBlocked}
            title={sendTitle}
            onClick={() => {
              if (canSend) onSend(value);
            }}
          >
            <ArrowUp aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
