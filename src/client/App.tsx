import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  Check,
  CircleAlert,
  Download,
  FilePlus2,
  FolderOpen,
  KeyRound,
  Menu,
  PanelRight,
  Plus,
  RotateCcw,
  Save,
  SearchCheck,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AiAction,
  ActionScope,
  Citation,
  PrdDocument,
  ProjectSummary,
  ReviewFinding,
  SourceSummary,
} from '@shared/types';
import { api, runAction } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources';
import { SectionEditor } from '@/components/SectionEditor';
import { ProviderDialog } from '@/components/ProviderDialog';

type PanelTab = 'assist' | 'review' | 'evidence';

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void api
      .projects()
      .then(({ projects: loaded }) => {
        setProjects(loaded);
        setSelectedId(loaded[0]?.id ?? null);
      })
      .catch((reason: unknown) => setError(messageFrom(reason)))
      .finally(() => setLoading(false));
  }, []);

  async function createProject(name: string) {
    const project = await api.createProject(name);
    setProjects((current) => [project, ...current]);
    setSelectedId(project.id);
  }

  async function importProject(file: File) {
    const { project } = await api.importProject(file);
    setProjects((current) => [project, ...current]);
    setSelectedId(project.id);
  }

  function updateProject(project: ProjectSummary) {
    setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
  }

  if (loading) {
    return (
      <main className="boot-state" aria-busy="true">
        <BookOpenText aria-hidden="true" />
        <p>Opening your local workspace</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="boot-state error-state">
        <CircleAlert aria-hidden="true" />
        <h1>Workspace unavailable</h1>
        <p>{error}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </main>
    );
  }

  if (!selectedId) {
    return <EmptyWorkspace onCreate={createProject} onImport={importProject} />;
  }

  const project = projects.find((item) => item.id === selectedId);
  if (!project) return null;

  return (
    <TooltipProvider>
      <Workbench
        key={project.id}
        project={project}
        projects={projects}
        onProjectSelect={setSelectedId}
        onProjectCreate={createProject}
        onProjectChange={updateProject}
      />
    </TooltipProvider>
  );
}

function EmptyWorkspace({
  onCreate,
  onImport,
}: {
  onCreate: (name: string) => Promise<void>;
  onImport: (file: File) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const importRef = useRef<HTMLInputElement | null>(null);

  return (
    <main className="onboarding">
      <div className="onboarding-mark">
        <BookOpenText aria-hidden="true" />
      </div>
      <p className="eyebrow">Local-first PRD workbench</p>
      <h1>Start with the document, not a chat.</h1>
      <p className="onboarding-copy">
        Build a structured PRD, ground it in your source material, and review every AI proposal
        before it changes the document.
      </p>
      <form
        className="create-project"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          setError('');
          void onCreate(name.trim())
            .catch((reason: unknown) => setError(messageFrom(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <label htmlFor="project-name">Project name</label>
        <input
          id="project-name"
          value={name}
          placeholder="Example: Billing redesign"
          maxLength={120}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" disabled={busy || !name.trim()}>
          <Plus aria-hidden="true" />
          Create project
        </Button>
      </form>
      <div className="import-prd">
        <span>or</span>
        <Button variant="outline" onClick={() => importRef.current?.click()}>
          <FilePlus2 aria-hidden="true" />
          Import an existing PRD
        </Button>
        <input
          ref={importRef}
          className="visually-hidden"
          type="file"
          aria-label="Import PRD file"
          accept=".md,.markdown,.docx,.txt"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError('');
            void onImport(file)
              .catch((reason: unknown) => setError(messageFrom(reason)))
              .finally(() => setBusy(false));
          }}
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="disk-note">
        Project data stays on this device. It relies on your operating system disk protection and is
        not independently encrypted.
      </p>
    </main>
  );
}

interface WorkbenchProps {
  project: ProjectSummary;
  projects: ProjectSummary[];
  onProjectSelect: (id: string) => void;
  onProjectCreate: (name: string) => Promise<void>;
  onProjectChange: (project: ProjectSummary) => void;
}

function Workbench({
  project,
  projects,
  onProjectSelect,
  onProjectCreate,
  onProjectChange,
}: WorkbenchProps) {
  const [prd, setPrd] = useState<PrdDocument | null>(null);
  const [savedPrd, setSavedPrd] = useState<PrdDocument | null>(null);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [selection, setSelection] = useState('');
  const [tab, setTab] = useState<PanelTab>('assist');
  const [railOpen, setRailOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [action, setAction] = useState<AiAction>('ask');
  const [scope, setScope] = useState<ActionScope>('section');
  const [output, setOutput] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [evidenceDetail, setEvidenceDetail] = useState<{
    locator: string;
    content: string;
  } | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<PrdDocument | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    Promise.all([api.prd(project.id), api.sources(project.id), api.findings(project.id)])
      .then(([document, sourceResult, findingResult]) => {
        setError('');
        setPrd(document);
        setSavedPrd(document);
        setSources(sourceResult.sources);
        setFindings(findingResult.findings);
        setSelectedSectionId(document.sections[0]?.id ?? '');
      })
      .catch((reason: unknown) => setError(messageFrom(reason)));
  }, [project.id]);

  const dirty = useMemo(
    () =>
      Boolean(
        prd && savedPrd && JSON.stringify(prd.sections) !== JSON.stringify(savedPrd.sections),
      ),
    [prd, savedPrd],
  );
  const selectedSection = prd?.sections.find((section) => section.id === selectedSectionId);

  async function save(reason = 'Manual edit') {
    if (!prd) return;
    setSaveBusy(true);
    setError('');
    try {
      const saved = await api.savePrd(project.id, prd.revision, prd.sections, reason);
      setPrd(saved);
      setSavedPrd(saved);
      setFindings((current) => current.map((finding) => ({ ...finding, status: 'stale' })));
    } catch (reasonCaught) {
      setError(messageFrom(reasonCaught));
    } finally {
      setSaveBusy(false);
    }
  }

  async function submitAction(instruction: string) {
    if (!prd || !project.selectedProvider || !project.selectedModel) {
      setProviderOpen(true);
      return;
    }
    if (dirty) await save('Saved before AI action');
    const current = dirty ? await api.prd(project.id) : prd;
    setBusy(true);
    setError('');
    setOutput('');
    setCitations([]);
    if (action === 'review') setFindings([]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runAction(
        {
          projectId: project.id,
          revision: current.revision,
          action,
          scope,
          provider: project.selectedProvider,
          model: project.selectedModel,
          ...(selectedSectionId ? { targetSectionId: selectedSectionId } : {}),
          ...(scope === 'selection' ? { selection } : {}),
          ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
        },
        {
          onText: (delta) => setOutput((value) => value + delta),
          onCitation: (citation) =>
            setCitations((value) =>
              value.some((item) => item.id === citation.id) ? value : [...value, citation],
            ),
          onFinding: (finding) => setFindings((value) => [...value, finding]),
          onStatus: (next) => setStatus(next.detail),
        },
        controller.signal,
      );
      if (action === 'review') setTab('review');
    } catch (reasonCaught) {
      if (!(reasonCaught instanceof DOMException && reasonCaught.name === 'AbortError')) {
        setError(messageFrom(reasonCaught));
      }
    } finally {
      setBusy(false);
      setStatus('');
      abortRef.current = null;
    }
  }

  async function applyOutput() {
    if (!prd || !selectedSection || !output.trim()) return;
    setUndoSnapshot(prd);
    const next: PrdDocument = {
      ...prd,
      sections: prd.sections.map((section) =>
        section.id === selectedSection.id ? { ...section, body: output.trim() } : section,
      ),
    };
    setPrd(next);
    const saved = await api.savePrd(
      project.id,
      next.revision,
      next.sections,
      `${action} proposal accepted`,
    );
    setPrd(saved);
    setSavedPrd(saved);
    setOutput('');
  }

  async function acceptFinding(finding: ReviewFinding) {
    if (!prd || !finding.proposedPatch || finding.sourceRevision !== prd.revision) return;
    setUndoSnapshot(prd);
    const nextSections = prd.sections.map((section) =>
      section.id === finding.proposedPatch?.sectionId
        ? { ...section, body: finding.proposedPatch.afterMarkdown }
        : section,
    );
    const saved = await api.savePrd(
      project.id,
      prd.revision,
      nextSections,
      'Review proposal accepted',
    );
    await api.setFindingStatus(project.id, finding.id, 'accepted');
    setPrd(saved);
    setSavedPrd(saved);
    setFindings((current) =>
      current.map((item) => (item.id === finding.id ? { ...item, status: 'accepted' } : item)),
    );
  }

  async function undoAccepted() {
    if (!prd || !undoSnapshot) return;
    const restored = await api.savePrd(
      project.id,
      prd.revision,
      undoSnapshot.sections,
      'Accepted proposal undone',
    );
    setPrd(restored);
    setSavedPrd(restored);
    setUndoSnapshot(null);
  }

  async function upload(file: File) {
    setError('');
    try {
      const source = await api.addSource(project.id, file);
      setSources((current) => [...current, source]);
    } catch (reason) {
      setError(messageFrom(reason));
    }
  }

  async function openCitation(citation: Citation) {
    setTab('evidence');
    setPanelOpen(true);
    try {
      const location = await api.sourceLocation(project.id, citation);
      setEvidenceDetail({ locator: location.locator, content: location.content });
    } catch (reason) {
      setError(messageFrom(reason));
    }
  }

  if (!prd) {
    return (
      <main className="boot-state" aria-busy="true">
        <BookOpenText aria-hidden="true" />
        <p>Loading project</p>
      </main>
    );
  }

  return (
    <div className="workbench">
      <a className="skip-link" href="#prd-editor">
        Skip to PRD editor
      </a>
      {offline && (
        <div className="offline-banner" role="status">
          You are offline. Editing and local sources remain available; provider actions are paused.
        </div>
      )}
      <header className="topbar">
        <Button
          className="mobile-only"
          variant="ghost"
          size="icon"
          aria-label="Open project navigation"
          onClick={() => setRailOpen(true)}
        >
          <Menu aria-hidden="true" />
        </Button>
        <div className="project-title">
          <span className="app-name">PRD Genie</span>
          <span aria-hidden="true">/</span>
          <strong>{project.name}</strong>
          {dirty && <span className="dirty-label">Unsaved</span>}
        </div>
        <div className="topbar-actions">
          <Button
            variant="outline"
            onClick={() => setProviderOpen(true)}
            aria-label="Configure model provider"
          >
            <KeyRound aria-hidden="true" />
            <span className="label-wide">{project.selectedModel ?? 'Configure model'}</span>
          </Button>
          <Button disabled={!dirty || saveBusy} onClick={() => void save()}>
            <Save aria-hidden="true" />
            <span className="label-wide">{saveBusy ? 'Saving' : 'Save'}</span>
          </Button>
          <Button
            className="mobile-only"
            variant="ghost"
            size="icon"
            aria-label="Open assist and review panel"
            onClick={() => setPanelOpen(true)}
          >
            <PanelRight aria-hidden="true" />
          </Button>
        </div>
      </header>

      <aside
        className={`left-rail ${railOpen ? 'drawer-open' : ''}`}
        aria-label="Project navigation"
      >
        <div className="drawer-heading mobile-only">
          <strong>Workspace</strong>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close navigation"
            onClick={() => setRailOpen(false)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <nav className="project-switcher" aria-label="Projects">
          <div className="rail-label">
            <span>Projects</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Create project"
              onClick={() => {
                const name = window.prompt('Project name');
                if (name?.trim()) void onProjectCreate(name.trim());
              }}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
          {projects.map((item) => (
            <button
              key={item.id}
              className={item.id === project.id ? 'rail-item selected' : 'rail-item'}
              onClick={() => {
                if (!dirty || window.confirm('Discard unsaved changes and switch projects?')) {
                  onProjectSelect(item.id);
                  setRailOpen(false);
                }
              }}
            >
              <FolderOpen aria-hidden="true" />
              <span>{item.name}</span>
            </button>
          ))}
        </nav>

        <nav className="outline" aria-label="Document outline">
          <div className="rail-label">
            <span>Outline</span>
            <span>{prd.sections.length}</span>
          </div>
          {prd.sections.map((section) => (
            <a
              key={section.id}
              href={`#section-${section.id}`}
              className={
                section.id === selectedSectionId ? 'outline-item selected' : 'outline-item'
              }
              onClick={() => {
                setSelectedSectionId(section.id);
                setRailOpen(false);
              }}
            >
              <span>{String(section.position + 1).padStart(2, '0')}</span>
              {section.title}
            </a>
          ))}
        </nav>

        <section className="source-rail" aria-labelledby="sources-heading">
          <div className="rail-label">
            <span id="sources-heading">Sources</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Add source"
              onClick={() => fileInputRef.current?.click()}
            >
              <FilePlus2 aria-hidden="true" />
            </Button>
          </div>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            aria-label="Add source file"
            accept=".pdf,.docx,.md,.markdown,.txt"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = '';
            }}
          />
          {sources.length === 0 ? (
            <button className="empty-source" onClick={() => fileInputRef.current?.click()}>
              Add evidence
              <small>PDF, DOCX, Markdown, or text</small>
            </button>
          ) : (
            sources.map((source) => (
              <div className="source-item" key={source.id}>
                <div>
                  <span>{source.name}</span>
                  <small>{source.status}</small>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${source.name}`}
                  onClick={() => {
                    if (!window.confirm(`Delete ${source.name} and its index?`)) return;
                    void api
                      .deleteSource(project.id, source.id)
                      .then(() =>
                        setSources((current) => current.filter((item) => item.id !== source.id)),
                      )
                      .catch((reason: unknown) => setError(messageFrom(reason)));
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))
          )}
        </section>
      </aside>

      <main id="prd-editor" className="document-surface">
        {undoSnapshot && (
          <div className="undo-banner" role="status">
            <span>A proposal changed the current revision.</span>
            <Button variant="ghost" size="sm" onClick={() => void undoAccepted()}>
              <RotateCcw aria-hidden="true" />
              Undo
            </Button>
          </div>
        )}
        {error && (
          <div className="inline-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss error"
              onClick={() => setError('')}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        )}
        <div className="document-heading">
          <p className="eyebrow">Product requirements document</p>
          <h1>{project.name}</h1>
          <p>{project.description || 'Define the decision, evidence, and delivery contract.'}</p>
        </div>
        <div className="sections">
          {prd.sections.map((section, index) => (
            <section
              key={section.id}
              id={`section-${section.id}`}
              className={section.id === selectedSectionId ? 'prd-section active' : 'prd-section'}
            >
              <div className="section-heading">
                <span className="section-number">{String(index + 1).padStart(2, '0')}</span>
                <input
                  aria-label="Section title"
                  value={section.title}
                  onFocus={() => setSelectedSectionId(section.id)}
                  onChange={(event) =>
                    setPrd((current) =>
                      current
                        ? {
                            ...current,
                            sections: current.sections.map((item) =>
                              item.id === section.id
                                ? { ...item, title: event.target.value }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
                <div className="section-controls">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${section.title} up`}
                    disabled={index === 0}
                    onClick={() => setPrd(reorder(prd, index, index - 1))}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${section.title} down`}
                    disabled={index === prd.sections.length - 1}
                    onClick={() => setPrd(reorder(prd, index, index + 1))}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${section.title}`}
                    disabled={prd.sections.length === 1}
                    onClick={() => {
                      if (!window.confirm(`Remove the ${section.title} section?`)) return;
                      setPrd({
                        ...prd,
                        sections: prd.sections
                          .filter((item) => item.id !== section.id)
                          .map((item, position) => ({ ...item, position })),
                      });
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <SectionEditor
                sectionId={section.id}
                value={section.body}
                onFocus={() => setSelectedSectionId(section.id)}
                onSelectionChange={setSelection}
                onChange={(body) =>
                  setPrd((current) =>
                    current
                      ? {
                          ...current,
                          sections: current.sections.map((item) =>
                            item.id === section.id ? { ...item, body } : item,
                          ),
                        }
                      : current,
                  )
                }
              />
            </section>
          ))}
          <Button
            variant="outline"
            className="add-section"
            onClick={() =>
              setPrd({
                ...prd,
                sections: [
                  ...prd.sections,
                  {
                    id: crypto.randomUUID(),
                    projectId: project.id,
                    title: 'New section',
                    body: '',
                    position: prd.sections.length,
                    updatedAt: new Date().toISOString(),
                  },
                ],
              })
            }
          >
            <Plus aria-hidden="true" />
            Add section
          </Button>
        </div>
      </main>

      <aside
        className={`right-panel ${panelOpen ? 'drawer-open' : ''}`}
        aria-label="Assist and review"
      >
        <div className="panel-tabs" role="tablist" aria-label="Assistant panels">
          {(['assist', 'review', 'evidence'] as const).map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              {value}
              {value === 'review' &&
                findings.filter((finding) => finding.status === 'open').length > 0 && (
                  <span>{findings.filter((finding) => finding.status === 'open').length}</span>
                )}
            </button>
          ))}
          <Button
            className="mobile-only panel-close"
            variant="ghost"
            size="icon-sm"
            aria-label="Close panel"
            onClick={() => setPanelOpen(false)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        {tab === 'assist' && (
          <div className="assist-panel">
            <div className="action-context">
              <label>
                <span>Action</span>
                <select
                  value={action}
                  onChange={(event) => setAction(event.target.value as AiAction)}
                >
                  <option value="ask">Ask</option>
                  <option value="rewrite">Rewrite</option>
                  <option value="draft">Draft</option>
                  <option value="review">Review</option>
                </select>
              </label>
              <label>
                <span>Scope</span>
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value as ActionScope)}
                >
                  <option value="section">Section</option>
                  <option value="selection" disabled={!selection}>
                    Selection{selection ? '' : ' unavailable'}
                  </option>
                  <option value="document">Document</option>
                </select>
              </label>
            </div>
            <p className="scope-caption">
              {scope === 'section'
                ? (selectedSection?.title ?? 'Choose a section')
                : scope === 'selection'
                  ? `${selection.length} selected characters`
                  : `${prd.sections.length} sections`}
            </p>

            <Conversation className="assist-conversation">
              <ConversationContent>
                {!output && !busy ? (
                  <ConversationEmptyState
                    icon={<SearchCheck />}
                    title="Work against the document"
                    description="Ask a question, draft a section, or request a review. Nothing is applied automatically."
                  />
                ) : (
                  <Message from="assistant">
                    <MessageContent>
                      {status && <p className="stream-status">{status}</p>}
                      <MessageResponse>{output}</MessageResponse>
                    </MessageContent>
                    {citations.length > 0 && (
                      <Sources>
                        <SourcesTrigger count={citations.length} />
                        <SourcesContent>
                          {citations.map((citation) => (
                            <Source
                              key={citation.id}
                              href="#"
                              title={`${citation.sourceName}, ${citation.locator}`}
                              onClick={(event) => {
                                event.preventDefault();
                                void openCitation(citation);
                              }}
                            />
                          ))}
                        </SourcesContent>
                      </Sources>
                    )}
                    {output && action !== 'ask' && (
                      <MessageActions>
                        <MessageAction
                          label="Apply to selected section"
                          tooltip="Creates a new revision"
                          onClick={() =>
                            void applyOutput().catch((reason: unknown) =>
                              setError(messageFrom(reason)),
                            )
                          }
                        >
                          <Check aria-hidden="true" />
                          Apply
                        </MessageAction>
                        <MessageAction
                          label="Dismiss proposal"
                          tooltip="Leaves the PRD unchanged"
                          onClick={() => setOutput('')}
                        >
                          <X aria-hidden="true" />
                          Dismiss
                        </MessageAction>
                      </MessageActions>
                    )}
                  </Message>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            <PromptInput onSubmit={({ text }) => submitAction(text)} className="assist-input">
              <PromptInputTextarea
                placeholder={
                  action === 'review'
                    ? 'Optional review focus'
                    : action === 'rewrite'
                      ? 'How should this be improved?'
                      : 'Ask about this PRD'
                }
                disabled={busy || offline}
              />
              <PromptInputFooter>
                <PromptInputTools>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setProviderOpen(true)}
                  >
                    <KeyRound aria-hidden="true" />
                    {project.selectedModel ?? 'Model'}
                  </Button>
                </PromptInputTools>
                <PromptInputSubmit
                  status={busy ? 'streaming' : 'ready'}
                  disabled={offline}
                  onClick={(event) => {
                    if (busy) {
                      event.preventDefault();
                      abortRef.current?.abort();
                    }
                  }}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        )}

        {tab === 'review' && (
          <div className="review-panel">
            <div className="panel-intro">
              <div>
                <p className="eyebrow">Structured review</p>
                <h2>Findings</h2>
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  setAction('review');
                  setScope('document');
                  void submitAction('Run the full structured review.');
                }}
              >
                Run review
              </Button>
            </div>
            {findings.length === 0 ? (
              <div className="panel-empty">
                <SearchCheck aria-hidden="true" />
                <p>No review findings yet.</p>
                <small>Run a review against the current revision.</small>
              </div>
            ) : (
              findings.map((finding) => (
                <article className={`finding finding-${finding.severity}`} key={finding.id}>
                  <header>
                    <span>{finding.category.replace('-', ' ')}</span>
                    <strong>{finding.severity}</strong>
                  </header>
                  <p>{finding.rationale}</p>
                  {finding.proposedPatch && (
                    <details>
                      <summary>Inspect proposed diff</summary>
                      <div className="diff">
                        <div>
                          <span>Current</span>
                          <pre>{finding.proposedPatch.beforeMarkdown || '(empty)'}</pre>
                        </div>
                        <div>
                          <span>Proposed</span>
                          <pre>{finding.proposedPatch.afterMarkdown}</pre>
                        </div>
                      </div>
                    </details>
                  )}
                  {finding.status === 'open' && (
                    <footer>
                      <Button
                        size="sm"
                        disabled={!finding.proposedPatch || finding.sourceRevision !== prd.revision}
                        onClick={() =>
                          void acceptFinding(finding).catch((reason: unknown) =>
                            setError(messageFrom(reason)),
                          )
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void api
                            .setFindingStatus(project.id, finding.id, 'dismissed')
                            .then(() =>
                              setFindings((current) =>
                                current.map((item) =>
                                  item.id === finding.id ? { ...item, status: 'dismissed' } : item,
                                ),
                              ),
                            )
                            .catch((reason: unknown) => setError(messageFrom(reason)))
                        }
                      >
                        Dismiss
                      </Button>
                    </footer>
                  )}
                  {finding.status !== 'open' && <small>Status: {finding.status}</small>}
                </article>
              ))
            )}
          </div>
        )}

        {tab === 'evidence' && (
          <div className="evidence-panel">
            <div className="panel-intro">
              <div>
                <p className="eyebrow">Exact source location</p>
                <h2>Evidence</h2>
              </div>
            </div>
            {evidenceDetail ? (
              <article className="evidence-detail">
                <strong>{evidenceDetail.locator}</strong>
                <p>{evidenceDetail.content}</p>
              </article>
            ) : citations.length > 0 ? (
              citations.map((citation) => (
                <button
                  key={citation.id}
                  className="citation-row"
                  onClick={() => void openCitation(citation)}
                >
                  <span>{citation.sourceName}</span>
                  <small>{citation.locator}</small>
                </button>
              ))
            ) : (
              <div className="panel-empty">
                <BookOpenText aria-hidden="true" />
                <p>No citations in the current action.</p>
                <small>Generated answers surface the exact excerpts they used.</small>
              </div>
            )}
          </div>
        )}

        <div className="export-row">
          <span>Export</span>
          {(['markdown', 'docx', 'pdf', 'archive'] as const).map((format) => (
            <a key={format} href={`/api/projects/${project.id}/export?format=${format}`}>
              <Download aria-hidden="true" />
              {format}
            </a>
          ))}
        </div>
      </aside>

      {(railOpen || panelOpen) && (
        <button
          className="drawer-scrim mobile-only"
          aria-label="Close open panel"
          onClick={() => {
            setRailOpen(false);
            setPanelOpen(false);
          }}
        />
      )}

      <ProviderDialog
        open={providerOpen}
        project={project}
        onOpenChange={setProviderOpen}
        onProjectChange={onProjectChange}
      />
    </div>
  );
}

function reorder(prd: PrdDocument, from: number, to: number): PrdDocument {
  if (to < 0 || to >= prd.sections.length) return prd;
  const sections = [...prd.sections];
  const [moved] = sections.splice(from, 1);
  if (!moved) return prd;
  sections.splice(to, 0, moved);
  return {
    ...prd,
    sections: sections.map((section, position) => ({ ...section, position })),
  };
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation could not be completed.';
}
