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
  History,
  KeyRound,
  Menu,
  PanelRight,
  Plus,
  RotateCcw,
  Save,
  SearchCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  AiAction,
  AiRunProposal,
  ChatGptHandoffSummary,
  ActionScope,
  Citation,
  PrdDocument,
  ProjectSummary,
  ReviewFinding,
  RevisionSummary,
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

type PanelTab = 'assist' | 'review' | 'evidence' | 'history';

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
    const { project } = file.name.toLowerCase().endsWith('.prdgenie.zip')
      ? await api.restoreProject(file)
      : await api.importProject(file);
    setProjects((current) => [project, ...current]);
    setSelectedId(project.id);
  }

  function updateProject(project: ProjectSummary) {
    setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
  }

  async function deleteProject(id: string) {
    await api.deleteProject(id);
    setProjects((current) => {
      const remaining = current.filter((item) => item.id !== id);
      setSelectedId(remaining[0]?.id ?? null);
      return remaining;
    });
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
        onProjectImport={importProject}
        onProjectChange={updateProject}
        onProjectDelete={deleteProject}
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
          accept=".md,.markdown,.docx,.txt,.prdgenie.zip"
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
  onProjectImport: (file: File) => Promise<void>;
  onProjectChange: (project: ProjectSummary) => void;
  onProjectDelete: (id: string) => Promise<void>;
}

function Workbench({
  project,
  projects,
  onProjectSelect,
  onProjectCreate,
  onProjectImport,
  onProjectChange,
  onProjectDelete,
}: WorkbenchProps) {
  const [prd, setPrd] = useState<PrdDocument | null>(null);
  const [savedPrd, setSavedPrd] = useState<PrdDocument | null>(null);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [aiRuns, setAiRuns] = useState<AiRunProposal[]>([]);
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [handoffs, setHandoffs] = useState<ChatGptHandoffSummary[]>([]);
  const [handoffInstruction, setHandoffInstruction] = useState('');
  const [handoffCitationIds, setHandoffCitationIds] = useState<string[]>([]);
  const [handoffDrafts, setHandoffDrafts] = useState<Record<string, Record<string, string | null>>>(
    {},
  );
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [selection, setSelection] = useState('');
  const [tab, setTab] = useState<PanelTab>('assist');
  const [railOpen, setRailOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [action, setAction] = useState<AiAction>('ask');
  const [scope, setScope] = useState<ActionScope>('section');
  const [output, setOutput] = useState('');
  const [proposalRunId, setProposalRunId] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [evidenceDetail, setEvidenceDetail] = useState<{
    locator: string;
    content: string;
    excerpt: string;
    available: boolean;
  } | null>(null);
  const [undoRevision, setUndoRevision] = useState<number | null>(null);
  const [findingDrafts, setFindingDrafts] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const handoffInputRef = useRef<HTMLInputElement | null>(null);

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
    Promise.all([
      api.prd(project.id),
      api.sources(project.id),
      api.findings(project.id),
      api.aiRuns(project.id),
      api.revisions(project.id),
      api.chatGptHandoffs(project.id),
    ])
      .then(([document, sourceResult, findingResult, runResult, revisionResult, handoffResult]) => {
        setError('');
        setPrd(document);
        setSavedPrd(document);
        setSources(sourceResult.sources);
        setFindings(findingResult.findings);
        setAiRuns(runResult.runs);
        setRevisions(revisionResult.revisions);
        setHandoffs(handoffResult.handoffs);
        setSelectedSectionId(document.sections[0]?.id ?? '');
      })
      .catch((reason: unknown) => setError(messageFrom(reason)));
  }, [project.id]);

  useEffect(() => {
    if (!sources.some((source) => source.status === 'processing')) return;
    const timer = window.setInterval(() => {
      void api
        .sources(project.id)
        .then((result) => setSources(result.sources))
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [project.id, sources]);

  const dirty = useMemo(
    () =>
      Boolean(
        prd && savedPrd && JSON.stringify(prd.sections) !== JSON.stringify(savedPrd.sections),
      ),
    [prd, savedPrd],
  );
  const selectedSection = prd?.sections.find((section) => section.id === selectedSectionId);

  async function save(reason = 'Manual edit'): Promise<PrdDocument | null> {
    if (!prd) return null;
    setSaveBusy(true);
    setError('');
    try {
      const saved = await api.savePrd(project.id, prd.revision, prd.sections, reason);
      setPrd(saved);
      setSavedPrd(saved);
      setFindings((current) => current.map((finding) => ({ ...finding, status: 'stale' })));
      void api.revisions(project.id).then((result) => setRevisions(result.revisions));
      return saved;
    } catch (reasonCaught) {
      setError(messageFrom(reasonCaught));
      return null;
    } finally {
      setSaveBusy(false);
    }
  }

  async function submitAction(
    instruction: string,
    override?: { action: AiAction; scope: ActionScope },
  ) {
    if (!prd || !project.selectedProvider || !project.selectedModel) {
      setProviderOpen(true);
      return;
    }
    const requestedAction = override?.action ?? action;
    const requestedScope = override?.scope ?? scope;
    if (offline && project.selectedProvider !== 'ollama') {
      setError('This provider requires a network connection. Local Ollama remains available.');
      return;
    }
    const savedBeforeAction = dirty ? await save('Saved before AI action') : prd;
    if (!savedBeforeAction) return;
    const current = savedBeforeAction;
    setBusy(true);
    setError('');
    setOutput('');
    setProposalRunId(null);
    setCitations([]);
    if (requestedAction === 'review') setFindings([]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runAction(
        {
          projectId: project.id,
          revision: current.revision,
          action: requestedAction,
          scope: requestedScope,
          provider: project.selectedProvider,
          model: project.selectedModel,
          ...(selectedSectionId ? { targetSectionId: selectedSectionId } : {}),
          ...(requestedScope === 'selection' ? { selection } : {}),
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
          onCompletion: (completion) => {
            setProposalRunId(completion.runId);
            void api.aiRuns(project.id).then((result) => setAiRuns(result.runs));
          },
        },
        controller.signal,
      );
      if (requestedAction === 'review') setTab('review');
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
    if (!prd || !proposalRunId || !output.trim() || dirty) return;
    const sourceRevision = prd.revision;
    const saved = await api.applyAiRun(project.id, proposalRunId, sourceRevision, output.trim());
    setUndoRevision(sourceRevision);
    setPrd(saved);
    setSavedPrd(saved);
    setOutput('');
    setProposalRunId(null);
    setFindings((current) =>
      current.map((finding) =>
        finding.status === 'open' ? { ...finding, status: 'stale' } : finding,
      ),
    );
    void Promise.all([api.revisions(project.id), api.aiRuns(project.id)]).then(
      ([revisionResult, runResult]) => {
        setRevisions(revisionResult.revisions);
        setAiRuns(runResult.runs);
      },
    );
  }

  async function acceptFinding(finding: ReviewFinding) {
    if (!prd || !finding.proposedPatch || finding.sourceRevision !== prd.revision || dirty) return;
    const sourceRevision = prd.revision;
    const revised = findingDrafts[finding.id];
    const saved = await api.acceptFinding(
      project.id,
      finding.id,
      sourceRevision,
      revised === undefined || revised === finding.proposedPatch.afterMarkdown
        ? undefined
        : revised,
    );
    setUndoRevision(sourceRevision);
    setPrd(saved);
    setSavedPrd(saved);
    setFindings((current) =>
      current.map((item) =>
        item.id === finding.id
          ? { ...item, status: 'accepted' }
          : item.status === 'open'
            ? { ...item, status: 'stale' }
            : item,
      ),
    );
    void Promise.all([api.revisions(project.id), api.aiRuns(project.id)]).then(
      ([revisionResult, runResult]) => {
        setRevisions(revisionResult.revisions);
        setAiRuns(runResult.runs);
      },
    );
  }

  async function undoAccepted() {
    if (!prd || undoRevision === null) return;
    const restored = await api.restoreRevision(project.id, undoRevision, prd.revision);
    setPrd(restored);
    setSavedPrd(restored);
    setUndoRevision(null);
    setRevisions((await api.revisions(project.id)).revisions);
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
    if (!citation.available || !citation.sourceId || !citation.locationId) {
      setEvidenceDetail({
        locator: citation.locator,
        content: 'The local source was deleted. This historical excerpt is retained for audit.',
        excerpt: citation.excerpt,
        available: false,
      });
      return;
    }
    try {
      const location = await api.sourceLocation(project.id, citation);
      setEvidenceDetail({
        locator: location.locator,
        content: location.content,
        excerpt: citation.excerpt,
        available: true,
      });
    } catch (reason) {
      setError(messageFrom(reason));
    }
  }

  async function createChatGptHandoff() {
    if (!prd || !selectedSectionId || !handoffInstruction.trim()) return;
    const handoffAction = action === 'ask' ? 'rewrite' : action;
    const handoffScope = scope === 'document' ? 'document' : 'section';
    const sectionIds =
      handoffScope === 'document' ? prd.sections.map((section) => section.id) : [selectedSectionId];
    const handoff = await api.createChatGptHandoff(project.id, {
      revision: prd.revision,
      action: handoffAction,
      scope: handoffScope,
      instruction: handoffInstruction.trim(),
      sectionIds,
      citationIds: handoffCitationIds,
    });
    setHandoffs((current) => [handoff, ...current]);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(handoff.request, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `prd-genie-request-${handoff.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importChatGptHandoff(file: File) {
    const handoff = await api.importChatGptHandoff(project.id, file);
    setHandoffs((current) => [handoff, ...current.filter((item) => item.id !== handoff.id)]);
    setTab('history');
  }

  async function applyChatGptHandoff(handoff: ChatGptHandoffSummary) {
    if (!prd || !handoff.response) return;
    const configured = handoffDrafts[handoff.id] ?? {};
    const patches = handoff.response.patches.flatMap((patch) => {
      const revised = configured[patch.sectionId];
      if (revised === null) return [];
      return [{ sectionId: patch.sectionId, afterMarkdown: revised ?? patch.afterMarkdown }];
    });
    if (patches.length === 0) {
      setError('Select at least one ChatGPT patch before applying the handoff.');
      return;
    }
    const restoredRevision = prd.revision;
    const saved = await api.applyChatGptHandoff(project.id, handoff.id, prd.revision, patches);
    setUndoRevision(restoredRevision);
    setPrd(saved);
    setSavedPrd(saved);
    const [handoffResult, revisionResult] = await Promise.all([
      api.chatGptHandoffs(project.id),
      api.revisions(project.id),
    ]);
    setHandoffs(handoffResult.handoffs);
    setRevisions(revisionResult.revisions);
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
          You are offline. Editing, local sources, and Ollama remain available. Remote provider
          actions are paused.
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
          <Button variant="ghost" size="sm" onClick={() => archiveInputRef.current?.click()}>
            <Upload aria-hidden="true" />
            Restore archive
          </Button>
          <input
            ref={archiveInputRef}
            className="visually-hidden"
            type="file"
            accept=".prdgenie.zip"
            aria-label="Restore PRD Genie project archive"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void onProjectImport(file).catch((reason: unknown) =>
                  setError(messageFrom(reason)),
                );
              }
              event.target.value = '';
            }}
          />
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
                  {source.error && <small>{source.error}</small>}
                </div>
                {(source.status === 'partial' || source.status === 'failed') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void api
                        .retrySourceIndex(project.id, source.id)
                        .then((updated) =>
                          setSources((current) =>
                            current.map((item) => (item.id === updated.id ? updated : item)),
                          ),
                        )
                        .catch((reason: unknown) => setError(messageFrom(reason)));
                    }}
                  >
                    Retry index
                  </Button>
                )}
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
        <section className="project-lifecycle" aria-label="Project data">
          <a href={`/api/projects/${project.id}/export?format=archive`}>
            <Download aria-hidden="true" />
            Export archive
          </a>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (
                !window.confirm(
                  `Delete ${project.name}? Export an archive first if you may need this project later.`,
                )
              )
                return;
              void onProjectDelete(project.id).catch((reason: unknown) =>
                setError(messageFrom(reason)),
              );
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete project
          </Button>
        </section>
      </aside>

      <main id="prd-editor" className="document-surface">
        {undoRevision !== null && (
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
          {(['assist', 'review', 'evidence', 'history'] as const).map((value) => (
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
                      <>
                        <p className="proposal-provenance">
                          Proposal from {project.selectedProvider} / {project.selectedModel},
                          revision {prd.revision}, {scope} scope
                        </p>
                        {!busy && (
                          <details className="proposal-revision">
                            <summary>Revise proposal before applying</summary>
                            <textarea
                              aria-label="Revised AI proposal"
                              value={output}
                              onChange={(event) => setOutput(event.target.value)}
                            />
                          </details>
                        )}
                        <MessageActions>
                          <MessageAction
                            label={`Apply to ${scope}`}
                            tooltip="Creates a revision bound to this AI run"
                            disabled={!proposalRunId || busy || dirty}
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
                            onClick={() => {
                              setOutput('');
                              setProposalRunId(null);
                            }}
                          >
                            <X aria-hidden="true" />
                            Dismiss
                          </MessageAction>
                        </MessageActions>
                      </>
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
                disabled={busy || (offline && project.selectedProvider !== 'ollama')}
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
                  disabled={offline && project.selectedProvider !== 'ollama'}
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
                disabled={busy || (offline && project.selectedProvider !== 'ollama')}
                onClick={() => {
                  setAction('review');
                  setScope('document');
                  void submitAction('Run the full structured review.', {
                    action: 'review',
                    scope: 'document',
                  });
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
                      {finding.status === 'open' && (
                        <label className="finding-revision">
                          <span>Revise before accepting</span>
                          <textarea
                            value={findingDrafts[finding.id] ?? finding.proposedPatch.afterMarkdown}
                            onChange={(event) =>
                              setFindingDrafts((current) => ({
                                ...current,
                                [finding.id]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      )}
                    </details>
                  )}
                  {finding.citations.length > 0 && (
                    <div className="finding-citations" aria-label="Finding evidence">
                      {finding.citations.map((citation) => (
                        <Button
                          key={citation.id}
                          variant="ghost"
                          size="sm"
                          onClick={() => void openCitation(citation)}
                        >
                          {citation.sourceName}, {citation.locator}
                        </Button>
                      ))}
                    </div>
                  )}
                  {finding.status === 'open' && (
                    <footer>
                      <Button
                        size="sm"
                        disabled={
                          !finding.proposedPatch || finding.sourceRevision !== prd.revision || dirty
                        }
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
                            .dismissFinding(project.id, finding.id)
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
                {!evidenceDetail.available && <small>Historical snapshot, source deleted</small>}
                <blockquote>{evidenceDetail.excerpt}</blockquote>
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
                  <small>
                    {citation.locator}
                    {citation.available ? '' : ' (source deleted)'}
                  </small>
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

        {tab === 'history' && (
          <div className="history-panel">
            <div className="panel-intro">
              <div>
                <p className="eyebrow">Durable project record</p>
                <h2>History</h2>
              </div>
            </div>
            <section className="history-section" aria-labelledby="chatgpt-handoff-heading">
              <h3 id="chatgpt-handoff-heading">ChatGPT handoff</h3>
              <div className="handoff-compose">
                <p>
                  Export only the current {scope === 'document' ? 'document' : 'section'} and the
                  evidence you select below. OpenAI processes this material inside ChatGPT. A
                  ChatGPT subscription does not provide API access to the standalone app.
                </p>
                <label>
                  <span>Instruction</span>
                  <textarea
                    value={handoffInstruction}
                    onChange={(event) => setHandoffInstruction(event.target.value)}
                    placeholder="Describe the draft, review, or rewrite you want ChatGPT to propose."
                    maxLength={10_000}
                  />
                </label>
                {citations.length > 0 && (
                  <fieldset>
                    <legend>Evidence excerpts to send</legend>
                    {citations.map((citation) => (
                      <label key={citation.id}>
                        <input
                          type="checkbox"
                          checked={handoffCitationIds.includes(citation.id)}
                          onChange={(event) =>
                            setHandoffCitationIds((current) =>
                              event.target.checked
                                ? [...current, citation.id]
                                : current.filter((id) => id !== citation.id),
                            )
                          }
                        />
                        <span>
                          {citation.sourceName}, {citation.locator}: {citation.excerpt}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
                <div className="handoff-actions">
                  <Button
                    size="sm"
                    disabled={!handoffInstruction.trim() || dirty}
                    onClick={() =>
                      void createChatGptHandoff().catch((reason: unknown) =>
                        setError(messageFrom(reason)),
                      )
                    }
                  >
                    <Download aria-hidden="true" />
                    Export request
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handoffInputRef.current?.click()}
                  >
                    <Upload aria-hidden="true" />
                    Import response
                  </Button>
                  <input
                    ref={handoffInputRef}
                    className="visually-hidden"
                    type="file"
                    accept="application/json,.json"
                    aria-label="Import ChatGPT handoff response"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void importChatGptHandoff(file).catch((reason: unknown) =>
                          setError(messageFrom(reason)),
                        );
                      }
                      event.target.value = '';
                    }}
                  />
                </div>
                {dirty && <small>Save the PRD before creating a handoff.</small>}
              </div>
              {handoffs.map((handoff) => (
                <article className="handoff-row" key={handoff.id}>
                  <header>
                    <div>
                      <strong>
                        {handoff.action} on {handoff.scope}
                      </strong>
                      <small>
                        Revision {handoff.sourceRevision}, {handoff.status}
                      </small>
                    </div>
                    <span>{new Date(handoff.createdAt).toLocaleString()}</span>
                  </header>
                  {handoff.response && (
                    <>
                      <p>{handoff.response.summary}</p>
                      {handoff.response.patches.map((patch) => {
                        const configured = handoffDrafts[handoff.id]?.[patch.sectionId];
                        const enabled = configured !== null;
                        const sectionTitle =
                          prd.sections.find((section) => section.id === patch.sectionId)?.title ??
                          'Unknown section';
                        return (
                          <label className="handoff-patch" key={patch.sectionId}>
                            <span>
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(event) =>
                                  setHandoffDrafts((current) => ({
                                    ...current,
                                    [handoff.id]: {
                                      ...current[handoff.id],
                                      [patch.sectionId]: event.target.checked
                                        ? patch.afterMarkdown
                                        : null,
                                    },
                                  }))
                                }
                              />
                              Apply to {sectionTitle}
                            </span>
                            <textarea
                              disabled={!enabled || handoff.status !== 'staged'}
                              value={configured ?? patch.afterMarkdown}
                              onChange={(event) =>
                                setHandoffDrafts((current) => ({
                                  ...current,
                                  [handoff.id]: {
                                    ...current[handoff.id],
                                    [patch.sectionId]: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                        );
                      })}
                      {handoff.response.findings.map((finding, index) => (
                        <div className="handoff-finding" key={`${handoff.id}-${index}`}>
                          <strong>
                            {finding.severity}: {finding.category.replace('-', ' ')}
                          </strong>
                          <p>{finding.rationale}</p>
                        </div>
                      ))}
                    </>
                  )}
                  <footer>
                    {handoff.status === 'staged' && (
                      <Button
                        size="sm"
                        disabled={handoff.sourceRevision !== prd.revision || dirty}
                        onClick={() =>
                          void applyChatGptHandoff(handoff).catch((reason: unknown) =>
                            setError(messageFrom(reason)),
                          )
                        }
                      >
                        <Check aria-hidden="true" />
                        Apply selected
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void api
                          .dismissChatGptHandoff(project.id, handoff.id)
                          .then(() =>
                            setHandoffs((current) =>
                              current.filter((item) => item.id !== handoff.id),
                            ),
                          )
                          .catch((reason: unknown) => setError(messageFrom(reason)))
                      }
                    >
                      Delete handoff
                    </Button>
                  </footer>
                </article>
              ))}
            </section>
            <section className="history-section" aria-labelledby="revision-history-heading">
              <h3 id="revision-history-heading">Revisions</h3>
              {revisions.map((revision) => (
                <article className="history-row" key={revision.id}>
                  <div>
                    <strong>Revision {revision.revision}</strong>
                    <span>{revision.reason}</span>
                    <small>{new Date(revision.createdAt).toLocaleString()}</small>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revision.revision === prd.revision || dirty}
                    onClick={() => {
                      if (
                        !window.confirm(`Restore revision ${revision.revision} as a new revision?`)
                      )
                        return;
                      void api
                        .restoreRevision(project.id, revision.revision, prd.revision)
                        .then(async (restored) => {
                          setPrd(restored);
                          setSavedPrd(restored);
                          setRevisions((await api.revisions(project.id)).revisions);
                        })
                        .catch((reason: unknown) => setError(messageFrom(reason)));
                    }}
                  >
                    <RotateCcw aria-hidden="true" />
                    Restore
                  </Button>
                </article>
              ))}
            </section>
            <section className="history-section" aria-labelledby="ai-history-heading">
              <h3 id="ai-history-heading">AI runs</h3>
              {aiRuns.length === 0 ? (
                <div className="panel-empty">
                  <History aria-hidden="true" />
                  <p>No AI actions yet.</p>
                </div>
              ) : (
                aiRuns.map((run) => (
                  <article className="history-row" key={run.id}>
                    <div>
                      <strong>
                        {run.action} on {run.scope}
                      </strong>
                      <span>
                        {run.provider} / {run.model}
                      </span>
                      <small>
                        Revision {run.sourceRevision}, {run.status},{' '}
                        {new Date(run.startedAt).toLocaleString()}
                      </small>
                    </div>
                    {run.outputText && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAction(run.action);
                          setScope(run.scope);
                          setOutput(run.outputText ?? '');
                          setCitations(run.citations);
                          setProposalRunId(
                            run.action !== 'ask' &&
                              run.appliedRevision === null &&
                              run.sourceRevision === prd.revision
                              ? run.id
                              : null,
                          );
                          setTab('assist');
                        }}
                      >
                        Inspect
                      </Button>
                    )}
                  </article>
                ))
              )}
            </section>
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
