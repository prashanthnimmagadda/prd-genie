import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ArrowLeftRight,
  Bold,
  BookOpen,
  CircleAlert,
  CircleCheck,
  CircleX,
  FilePlus,
  FolderOpen,
  Italic,
  LifeBuoy,
  List,
  ListChecks,
  ListOrdered,
  CircleHelp,
  PanelLeft,
  PanelRight,
  Paperclip,
  PenLine,
  Plus,
  Redo2,
  SearchCheck,
  Share,
  TriangleAlert,
  Undo2,
  WifiOff,
  X,
} from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type {
  AiAction,
  AiRunProposal,
  GroundingAssessment,
  ChatGptHandoffSummary,
  ActionScope,
  Citation,
  PrdDocument,
  ProjectSummary,
  ProviderState,
  ReviewFinding,
  RevisionSummary,
  SourceSummary,
  StructureSection,
  StructureTemplate,
  WorkspaceState,
  WorkspaceTurn,
} from '@shared/types';
import { DEFAULT_STRUCTURE_SECTIONS } from '@shared/default-structure';
import { api, ClientApiError, runAction } from '@/lib/api';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { isNative, postShellState, readLocalPrompt } from '@/lib/native-shell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MessageResponse } from '@/components/ai-elements/message';
import { providerIsLocal, providerLabels } from '@/lib/provider-display';
import {
  actionForInstruction,
  countsSource,
  formatBytes,
  formatTime,
  lineDiff,
  messageFrom,
  projectNameFromInstruction,
  sectionNumber,
  truncateText,
} from '@/lib/format';
import { exampleSource, exampleSourceName, fillExample } from '@/example-project';
import { Sidebar } from '@/components/workbench/Sidebar';
import { destinationTitles, type Destination } from '@/lib/destinations';
import { Composer } from '@/components/workbench/Composer';
import {
  AcceptedRow,
  DiffView,
  InvalidCitationRow,
  ProposalCard,
  ReviewBlock,
  StaleRow,
} from '@/components/workbench/cards';
import {
  SourcesView,
  type EvidenceDetail,
  type NotAddedFile,
} from '@/components/workbench/SourcesView';
import { HandoffSheet, HistoryView, type HistoryTab } from '@/components/workbench/HistoryView';
import { SettingsView } from '@/components/workbench/SettingsView';
import {
  BUILT_IN_STRUCTURE_ID,
  StructuresView,
  type StructureEntry,
} from '@/components/workbench/StructuresView';
import { DocumentView } from '@/components/workbench/DocumentView';

interface ProposalContext {
  sourceRunId: string | null;
  runId: string | null;
  sourceRevision: number;
  action: AiAction;
  scope: ActionScope;
  provider: AiRunProposal['provider'];
  model: string;
  appliedRevision: number | null;
  targetSectionId: string | null;
  selectionText: string | null;
  instruction?: string | null;
  grounding?: GroundingAssessment | null;
}

const SIDEBAR_KEY = 'prd-genie:sidebar-width';
const INSPECTOR_KEY = 'prd-genie:inspector-open';
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(
    () =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.reduceMotion === 'true',
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () =>
      setReduce(query.matches || document.documentElement.dataset.reduceMotion === 'true');
    query.addEventListener('change', update);
    window.addEventListener('prd-accessibility', update);
    return () => {
      query.removeEventListener('change', update);
      window.removeEventListener('prd-accessibility', update);
    };
  }, []);
  return reduce;
}

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importNotices, setImportNotices] = useState<Record<string, string>>({});

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

  async function createProject(name: string, instruction = '', files: File[] = []) {
    const project = await api.createProject(name);
    setProjects((current) => [project, ...current]);
    const warnings: string[] = [];
    try {
      if (instruction)
        await api.saveWorkspace(project.id, {
          revision: 0,
          prompt: instruction,
          turns: [],
          draft: null,
        });
      for (const file of files) {
        try {
          await api.addSource(project.id, file);
        } catch (reason) {
          warnings.push(`${file.name}: ${messageFrom(reason)}`);
        }
      }
    } catch (reason) {
      throw new Error(
        `The project was created, but the instruction could not be saved. Your text is still here. ${messageFrom(reason)}`,
        { cause: reason },
      );
    }
    if (warnings.length)
      setImportNotices((current) => ({
        ...current,
        [project.id]: `Not added: ${warnings.join(' ')}`,
      }));
    setSelectedId(project.id);
  }

  async function createExampleProject() {
    const project = await api.createProject('Explore: meeting scheduler', 'Fictional example');
    const document = await api.prd(project.id);
    await api.savePrd(project.id, document.revision, fillExample(document), 'Example PRD added');
    await api.addSource(
      project.id,
      new File([exampleSource], exampleSourceName, { type: 'text/plain' }),
    );
    setProjects((current) => [project, ...current]);
    setSelectedId(project.id);
  }

  async function importProject(file: File) {
    let project: ProjectSummary;
    try {
      if (
        file.name.toLowerCase().endsWith('.prdgenie.zip') ||
        file.name.toLowerCase().endsWith('.prdgenie')
      ) {
        project = (await api.restoreProject(file)).project;
      } else {
        const imported = await api.importProject(file);
        project = imported.project;
        if (imported.warnings.length > 0) {
          setImportNotices((current) => ({
            ...current,
            [project.id]: `Imported “${file.name}” as a new project. Check: ${imported.warnings.join(' ')}`,
          }));
        }
      }
    } catch (reason) {
      throw new Error(`Couldn’t import “${file.name}”: ${messageFrom(reason)}`, { cause: reason });
    }
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
        <BookOpen aria-hidden="true" />
        <p>Opening your local workspace</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="boot-state">
        <CircleAlert aria-hidden="true" />
        <h1>Workspace unavailable</h1>
        <p>{error}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Retry
        </button>
      </main>
    );
  }

  if (!selectedId) {
    return (
      <StartScreen
        onCreate={createProject}
        onImport={importProject}
        onExample={createExampleProject}
      />
    );
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
        importNotice={importNotices[project.id] ?? ''}
        onDismissImportNotice={() =>
          setImportNotices((current) => {
            const next = { ...current };
            delete next[project.id];
            return next;
          })
        }
      />
    </TooltipProvider>
  );
}

function StartScreen({
  onCreate,
  onImport,
  onExample,
}: {
  onCreate: (name: string, instruction?: string, files?: File[]) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onExample: () => Promise<void>;
}) {
  const [instruction, setInstruction] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const importRef = useRef<HTMLInputElement | null>(null);
  const sourcesRef = useRef<HTMLInputElement | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement | null>(null);

  const perform = useCallback(
    async (operation: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setError('');
      try {
        await operation();
      } catch (reason) {
        setError(messageFrom(reason));
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  useEffect(() => {
    postShellState({
      title: 'PRD Genie',
      subtitle: '',
      dirty: false,
      busy,
      recoveryPending: Boolean(instruction || files.length),
      hasProject: false,
    });
  }, [busy, instruction, files.length]);

  useEffect(() => {
    const command = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === 'new-project') instructionRef.current?.focus();
      if (detail === 'import') importRef.current?.click();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || isNative) return;
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        importRef.current?.click();
      }
      if (event.key.toLowerCase() === 'n' && event.shiftKey) {
        event.preventDefault();
        void perform(() => onCreate('Untitled project'));
      }
    };
    window.addEventListener('prd-command', command);
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('prd-command', command);
      window.removeEventListener('keydown', keyboard);
    };
  }, [perform, onCreate]);

  useEffect(() => {
    const element = instructionRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(264, Math.max(66, element.scrollHeight))}px`;
  }, [instruction]);

  function create() {
    void perform(() => onCreate(projectNameFromInstruction(instruction), instruction, files));
  }

  return (
    <main className="start" aria-label="Start" aria-busy={busy}>
      <div className="start-inner">
        <div className="start-heading">
          <span className="t-label" style={{ fontSize: 13, lineHeight: '18px' }}>
            PRD Genie
          </span>
          <h1>What are you working on?</h1>
          <p>
            Describe a product, paste rough notes or ask for a review. Your project stays on this
            Mac.
          </p>
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <label className="visually-hidden" htmlFor="first-instruction">
            Your instruction
          </label>
          <textarea
            id="first-instruction"
            ref={instructionRef}
            value={instruction}
            autoFocus
            rows={3}
            style={{ minHeight: 66 }}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                create();
              }
            }}
            placeholder="For example: a scheduler that helps coordinators find a time and a free room"
            maxLength={20000}
            disabled={busy}
          />
          {files.length > 0 && (
            <ul className="pending-files">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  <Paperclip aria-hidden="true" />
                  <span>{file.name}</span>
                  <button
                    type="button"
                    className="btn btn-icon"
                    style={{ width: 20, height: 20 }}
                    disabled={busy}
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  >
                    <X aria-hidden="true" style={{ width: 12, height: 12 }} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="composer-row">
            <button
              type="button"
              className="chip"
              style={{ fontSize: 13 }}
              disabled={busy}
              onClick={() => sourcesRef.current?.click()}
            >
              <Paperclip aria-hidden="true" />
              Add material…
            </button>
            <span style={{ flex: 1 }} />
            <span className="t-secondary" style={{ fontSize: 11 }} aria-hidden="true">
              ⌘↩
            </span>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy}
              style={{ marginLeft: 4 }}
            >
              Create project
            </button>
          </div>
        </form>
        <div className="start-options">
          <span className="t-label">Other ways to start</span>
          <button
            type="button"
            className="start-option"
            disabled={busy}
            onClick={() => importRef.current?.click()}
          >
            <FolderOpen aria-hidden="true" />
            <span>Open an existing PRD or archive…</span>
            <span className="t-secondary">Markdown, Word, text or .prdgenie</span>
            <span className="t-secondary" aria-hidden="true">
              ⌘O
            </span>
          </button>
          <button
            type="button"
            className="start-option"
            disabled={busy}
            onClick={() => void perform(onExample)}
          >
            <BookOpen aria-hidden="true" />
            <span>Explore the example</span>
            <span className="t-secondary">A fictional meeting-scheduler PRD</span>
          </button>
          <button
            type="button"
            className="start-option"
            disabled={busy}
            onClick={() => void perform(() => onCreate('Untitled project'))}
          >
            <FilePlus aria-hidden="true" />
            <span>Blank PRD</span>
            <span className="t-secondary">Default 13-section structure</span>
            <span className="t-secondary" aria-hidden="true">
              ⇧⌘N
            </span>
          </button>
        </div>
        {error && (
          <p className="t-secondary start-footnote" role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        <p className="t-secondary start-footnote">
          No account needed. Editing, history and export work offline. Nothing is sent to AI until
          you choose a model and press Send.
        </p>
      </div>
      <input
        ref={sourcesRef}
        className="visually-hidden"
        type="file"
        hidden
        multiple
        aria-label="Add starting material"
        accept=".txt,.md,.markdown,.pdf,.docx,.pptx,.xlsx,.jpg,.jpeg"
        onChange={(event) => {
          setFiles((current) => [...current, ...Array.from(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
      <input
        ref={importRef}
        className="visually-hidden"
        type="file"
        hidden
        aria-label="Import PRD file"
        accept=".md,.markdown,.docx,.txt,.prdgenie.zip,.prdgenie"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void perform(() => onImport(file));
          event.target.value = '';
        }}
      />
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
  importNotice: string;
  onDismissImportNotice: () => void;
}

type AlertKind =
  | { kind: 'delete-project' }
  | { kind: 'remove-source'; source: SourceSummary }
  | { kind: 'remove-section'; sectionId: string }
  | { kind: 'restore'; revision: RevisionSummary }
  | { kind: 'use-structure'; entry: StructureEntry }
  | { kind: 'delete-structure'; structure: StructureTemplate }
  | { kind: 'discard-recovery' };

function Workbench({
  project,
  projects,
  onProjectSelect,
  onProjectCreate,
  onProjectImport,
  onProjectChange,
  onProjectDelete,
  importNotice,
  onDismissImportNotice,
}: WorkbenchProps) {
  const viewport = useViewportWidth();
  const reduceMotion = useReduceMotion();
  const narrow = viewport < 900;
  const inspectorOverlay = viewport < 1180;

  const [destination, setDestinationState] = useState<Destination>('conversation');
  const [sidebarOpen, setSidebarOpen] = useState(() => !(window.innerWidth < 900));
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(readStored(SIDEBAR_KEY));
    return stored >= 200 && stored <= 320 ? stored : 240;
  });
  const [inspectorOpen, setInspectorOpen] = useState(() => readStored(INSPECTOR_KEY) === 'true');
  const [historyTab, setHistoryTab] = useState<HistoryTab>('revisions');
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [notAdded, setNotAdded] = useState<NotAddedFile[]>([]);
  const [alert, setAlert] = useState<AlertKind | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'markdown' | 'docx' | 'pdf' | 'archive'>(
    'markdown',
  );
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [structures, setStructures] = useState<StructureTemplate[]>([]);
  const [structureSelection, setStructureSelection] = useState<string>('');
  const [flashSectionId, setFlashSectionId] = useState<string | null>(null);
  const [acceptedInfo, setAcceptedInfo] = useState<{ section: string; revision: number } | null>(
    null,
  );
  const [rejectedSection, setRejectedSection] = useState<string | null>(null);
  const [failure, setFailure] = useState<string>('');
  const [stoppedAt, setStoppedAt] = useState<string>('');
  const [queued, setQueued] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [toolbarScrolled, setToolbarScrolled] = useState(false);

  const [turns, setTurns] = useState<WorkspaceTurn[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [recoveryConflict, setRecoveryConflict] = useState<WorkspaceState['draft']>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState('');
  const [recoverySavedKey, setRecoverySavedKey] = useState('');
  const recoveryRevision = useRef(0);
  const recoveryQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const recoveryBlocked = useRef(false);
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [recoveryReadOnly, setRecoveryReadOnly] = useState(false);
  const [proposalDraft, setProposalDraft] = useState<WorkspaceState['proposal']>(undefined);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const navigationRef = useRef(false);
  const recoverySnapshot = useRef<Omit<WorkspaceState, 'revision'> | null>(null);
  const recoverySaved = useRef('');
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
  const [groundingAcknowledgement, setGroundingAcknowledgement] = useState<{
    context: ProposalContext;
    text: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [activitySequence, setActivitySequence] = useState(0);
  const [stalled, setStalled] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [providerState, setActiveProviderState] = useState<ProviderState | null>(null);
  const activeProviderState =
    providerState?.provider === project.selectedProvider ? providerState : null;
  const [scope, setScopeState] = useState<ActionScope>('document');
  const scopeBeforeSelection = useRef<ActionScope>('document');
  const [output, setOutput] = useState('');
  const [prompt, setPrompt] = useState(() => readLocalPrompt(project.id));
  const [interrupted, setInterrupted] = useState(false);
  const [proposalContext, setProposalContext] = useState<ProposalContext | null>(null);
  const [activeReviewGrounding, setActiveReviewGrounding] = useState<{
    runId: string;
    sourceRevision: number;
    grounding: GroundingAssessment;
  } | null>(null);
  const groundingReviewRequired = proposalContext?.grounding?.status === 'review_required';
  const groundingReviewed =
    groundingAcknowledgement?.context === proposalContext &&
    groundingAcknowledgement?.text === output;
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [documentMutationBusy, setDocumentMutationBusy] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [evidenceDetail, setEvidenceDetail] = useState<EvidenceDetail | null>(null);
  const [undoRevision, setUndoRevision] = useState<number | null>(null);
  const [findingDrafts, setFindingDrafts] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const exportButtonRef = useRef<HTMLButtonElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const documentMutationRef = useRef(false);
  const editors = useRef(new Map<string, Editor>());
  const contentRef = useRef<HTMLDivElement | null>(null);

  const setDestination = useCallback(
    (next: Destination) => {
      setGroundingAcknowledgement(null);
      setDestinationState(next);
      if (narrow) setSidebarOpen(false);
      if (next !== 'sources') setEvidenceDetail(null);
    },
    [narrow],
  );

  const setScope = useCallback((next: ActionScope, targetSectionId?: string | null) => {
    setScopeState(next);
    if (next !== 'selection') scopeBeforeSelection.current = next;
    if (targetSectionId) setSelectedSectionId(targetSectionId);
  }, []);

  // Apply to follows a text selection in Document and returns when it clears.
  useEffect(() => {
    if (selection.trim()) {
      setScopeState((current) => {
        if (current !== 'selection') scopeBeforeSelection.current = current;
        return 'selection';
      });
    } else {
      setScopeState((current) =>
        current === 'selection' ? scopeBeforeSelection.current : current,
      );
    }
  }, [selection]);

  useEffect(() => {
    writeStored(SIDEBAR_KEY, String(sidebarWidth));
  }, [sidebarWidth]);
  useEffect(() => {
    writeStored(INSPECTOR_KEY, String(inspectorOpen));
  }, [inspectorOpen]);
  useEffect(() => {
    if (narrow) setSidebarOpen(false);
    else setSidebarOpen(true);
  }, [narrow]);

  useEffect(() => {
    if (destination === 'settings' || !project.selectedProvider) return;
    let current = true;
    void api
      .providerStates()
      .then(({ providers }) => {
        if (current)
          setActiveProviderState(
            providers.find((item) => item.provider === project.selectedProvider) ?? null,
          );
      })
      .catch(() => {
        if (current) setActiveProviderState(null);
      });
    return () => {
      current = false;
    };
  }, [destination, project.selectedProvider]);

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
      api.workspace(project.id).catch((reason: unknown): WorkspaceState => {
        recoveryBlocked.current = true;
        setRecoveryUnavailable(true);
        setRecoveryReadOnly(true);
        setStorageError(
          `Recovery is unavailable. The saved PRD can still be viewed and exported. Editing is paused to protect the recovery record. ${messageFrom(reason)}`,
        );
        return { revision: 0, prompt: '', turns: [], draft: null };
      }),
    ])
      .then(
        ([
          document,
          sourceResult,
          findingResult,
          runResult,
          revisionResult,
          handoffResult,
          workspace,
        ]) => {
          setError('');
          if (workspace.draft?.baseRevision === document.revision) {
            setPrd({ ...document, sections: workspace.draft.sections });
            setRecoveryStatus('Recovered unsaved edits. Review the document and save when ready.');
          } else {
            setPrd(document);
            if (workspace.draft) setRecoveryConflict(workspace.draft);
          }
          setSavedPrd(document);
          setTurns(workspace.turns);
          setFindingDrafts(workspace.findingDrafts ?? {});
          setHandoffInstruction(workspace.handoffInstruction ?? '');
          setHandoffDrafts(workspace.handoffDrafts ?? {});
          setProposalDraft(workspace.proposal);
          const savedProposal = workspace.proposal;
          if (savedProposal?.text) {
            const run = runResult.runs.find((item) => item.id === savedProposal.runId);
            setOutput(savedProposal.text);
            if (run) {
              setCitations(run.citations);
              setProposalContext(contextForRun(run, document.revision, workspace.turns));
              setActiveTurnId(workspace.turns.find((turn) => turn.runId === run.id)?.id ?? null);
            }
          } else if (!savedProposal) {
            // No saved edit or rejection: the latest unapplied proposal stays open in the conversation.
            const lastTurn = workspace.turns[workspace.turns.length - 1];
            const run = lastTurn?.runId
              ? runResult.runs.find((item) => item.id === lastTurn.runId)
              : undefined;
            if (
              lastTurn &&
              run &&
              (run.action === 'draft' || run.action === 'rewrite') &&
              run.status === 'completed' &&
              run.appliedRevision === null &&
              run.outputText
            ) {
              setOutput(run.outputText);
              setCitations(run.citations);
              setProposalContext(contextForRun(run, document.revision, workspace.turns));
              setActiveTurnId(lastTurn.id);
            }
          }
          if (workspace.revision > 0) {
            setPrompt(workspace.prompt);
            if (workspace.prompt.trim()) setDraftRestored(true);
          }
          recoveryRevision.current = workspace.revision;
          const recoveredKey = JSON.stringify({
            prompt: workspace.prompt,
            turns: workspace.turns,
            proposal: workspace.proposal,
            findingDrafts: workspace.findingDrafts ?? {},
            handoffInstruction: workspace.handoffInstruction ?? '',
            handoffDrafts: workspace.handoffDrafts ?? {},
            draft: workspace.draft,
          });
          recoverySaved.current = recoveredKey;
          setRecoverySavedKey(recoveredKey);
          setWorkspaceLoaded(true);
          setSources(sourceResult.sources);
          setFindings(findingResult.findings);
          setAiRuns(runResult.runs);
          setRevisions(revisionResult.revisions);
          setHandoffs(handoffResult.handoffs);
          setSelectedSectionId(document.sections[0]?.id ?? '');
        },
      )
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

  const structuresVisible = destination === 'structures';
  useEffect(() => {
    let current = true;
    void api
      .structures(project.id)
      .then((result) => {
        if (!current) return;
        setStructures(result.structures);
        setStructureSelection((selected) => {
          if (
            selected &&
            (selected === BUILT_IN_STRUCTURE_ID ||
              result.structures.some((item) => item.id === selected))
          )
            return selected;
          return result.selectedStructureId ?? result.structures[0]?.id ?? BUILT_IN_STRUCTURE_ID;
        });
      })
      .catch((reason: unknown) => {
        if (current) setError(messageFrom(reason));
      });
    return () => {
      current = false;
    };
  }, [structuresVisible, project.id]);

  const dirty = useMemo(
    () =>
      Boolean(
        prd && savedPrd && JSON.stringify(prd.sections) !== JSON.stringify(savedPrd.sections),
      ),
    [prd, savedPrd],
  );

  const workspaceSnapshot = useMemo(
    () =>
      !workspaceLoaded || !prd
        ? null
        : {
            prompt,
            turns,
            proposal: proposalDraft,
            findingDrafts,
            handoffInstruction,
            handoffDrafts,
            draft:
              recoveryConflict ??
              (dirty ? { baseRevision: prd.revision, sections: prd.sections } : null),
          },
    [
      workspaceLoaded,
      prd,
      prompt,
      turns,
      proposalDraft,
      findingDrafts,
      handoffInstruction,
      handoffDrafts,
      recoveryConflict,
      dirty,
    ],
  );
  const workspaceFingerprint = useMemo(
    () => JSON.stringify(workspaceSnapshot),
    [workspaceSnapshot],
  );
  const recoveryPending =
    workspaceLoaded && !recoveryReadOnly && workspaceFingerprint !== recoverySavedKey;

  useEffect(() => {
    if (!dirty && !recoveryPending && !busy) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty, recoveryPending, busy]);

  async function runDocumentMutation<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (documentMutationRef.current) return undefined;
    if (recoveryUnavailable) return undefined;
    if (recoveryConflict) {
      setRecoveryOpen(true);
      return undefined;
    }
    documentMutationRef.current = true;
    setDocumentMutationBusy(true);
    try {
      return await operation();
    } finally {
      documentMutationRef.current = false;
      setDocumentMutationBusy(false);
    }
  }

  async function save(reason = 'Manual edit'): Promise<PrdDocument | null> {
    if (!prd || documentMutationRef.current) return null;
    if (recoveryConflict) {
      setRecoveryOpen(true);
      return null;
    }
    setSaveBusy(true);
    setError('');
    try {
      const saved = await runDocumentMutation(() =>
        api.savePrd(project.id, prd.revision, prd.sections, reason),
      );
      if (!saved) return null;
      setPrd(saved);
      setSavedPrd(saved);
      setSaveFailed('');
      if (recoverySnapshot.current)
        recoverySnapshot.current = { ...recoverySnapshot.current, draft: null };
      setUndoRevision(null);
      setAcceptedInfo(null);
      setFindings((current) => current.map((finding) => ({ ...finding, status: 'stale' })));
      void api.revisions(project.id).then((result) => setRevisions(result.revisions));
      return saved;
    } catch (reasonCaught) {
      setSaveFailed(messageFrom(reasonCaught));
      return null;
    } finally {
      setSaveBusy(false);
    }
  }

  async function exportCurrent(format: 'markdown' | 'docx' | 'pdf' | 'archive') {
    if (documentMutationRef.current || !prd) return;
    if (recoveryConflict) {
      setExportOpen(false);
      setRecoveryOpen(true);
      return;
    }
    setExportStatus('');
    if (dirty && !(await save('Saved before export'))) {
      setExportStatus(
        'Export paused because the document could not be saved. Your edits are still here.',
      );
      return;
    }
    const link = document.createElement('a');
    link.href = `/api/projects/${project.id}/export?format=${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setExportOpen(false);
    setExportStatus(isNative ? '' : 'Export requested. Check your browser downloads.');
  }

  function describeFailure(reason: unknown): string {
    const provider = project.selectedProvider
      ? providerLabels[project.selectedProvider]
      : 'The provider';
    if (reason instanceof ClientApiError) {
      switch (reason.code) {
        case 'invalid_credentials':
        case 'missing_credentials':
          return `${provider} rejected the key. Update it in AI settings.`;
        case 'rate_limit':
          return `${provider} reports a usage limit. Nothing was changed.`;
        case 'network_failure':
        case 'provider_unavailable':
          return project.selectedProvider === 'ollama'
            ? 'Ollama isn’t running. Start Ollama, then try again.'
            : `${provider} didn’t respond. Nothing was changed, and your instruction is back in the composer.`;
        case 'sign_in_required':
          return 'ChatGPT sign-in expired. Sign in again to use your ChatGPT plan.';
        default:
          return reason.message;
      }
    }
    if (reason instanceof DOMException && reason.name === 'TimeoutError')
      return `${provider} didn’t respond within 60 seconds. Nothing was changed, and your instruction is back in the composer.`;
    return messageFrom(reason);
  }

  async function submitAction(
    instruction: string,
    override?: { action: AiAction; scope: ActionScope; targetSectionId?: string | null },
  ): Promise<boolean> {
    if (documentMutationRef.current) return false;
    if (recoveryUnavailable) return false;
    if (recoveryConflict) {
      setRecoveryOpen(true);
      return false;
    }
    if (!prd || !project.selectedProvider || !project.selectedModel) {
      setDestination('settings');
      return false;
    }
    if (busy) {
      setQueued(instruction);
      return false;
    }
    if (instruction.length > 10000) {
      setError(
        'Keep the instruction under 10,000 characters. Add longer material as a source; your text is retained.',
      );
      return false;
    }
    const requestedAction = override?.action ?? actionForInstruction(instruction, prd);
    const requestedScope = override?.scope ?? scope;
    const requestedTargetSectionId =
      requestedScope === 'document'
        ? null
        : (override?.targetSectionId ?? selectedSectionId ?? null);
    const requestedSelectionText = requestedScope === 'selection' ? selection : null;
    if (!requestedTargetSectionId && requestedScope !== 'document') {
      setError('Choose a section in the Apply to menu before sending.');
      return false;
    }
    if (requestedScope === 'selection' && !requestedSelectionText?.trim()) {
      setError('Select text in Document first, or choose another Apply to option.');
      return false;
    }
    if (offline && !providerIsLocal(project.selectedProvider, activeProviderState)) {
      setError(
        'You’re offline. Online models can’t be used to send; models on this Mac still work.',
      );
      return false;
    }
    const savedBeforeAction = dirty ? await save('Saved before AI action') : prd;
    if (!savedBeforeAction) return false;
    const current = savedBeforeAction;
    setActiveReviewGrounding(null);
    setBusy(true);
    setFailure('');
    setStoppedAt('');
    setSubmittedPrompt(instruction.trim());
    const turnId = crypto.randomUUID();
    setActiveTurnId(turnId);
    setTurns((items) => [
      ...items,
      { id: turnId, request: instruction.trim(), response: '', runId: null, status: 'interrupted' },
    ]);
    setActivitySequence((sequence) => sequence + 1);
    setStalled(false);
    setDestination('conversation');
    setError('');
    setOutput('');
    setInterrupted(false);
    setAcceptedInfo(null);
    setRejectedSection(null);
    setProposalContext(
      requestedAction === 'draft' || requestedAction === 'rewrite'
        ? {
            sourceRunId: null,
            runId: null,
            sourceRevision: current.revision,
            action: requestedAction,
            scope: requestedScope,
            provider: project.selectedProvider,
            model: project.selectedModel,
            appliedRevision: null,
            targetSectionId: requestedTargetSectionId,
            selectionText: requestedSelectionText,
            instruction: instruction.trim(),
          }
        : null,
    );
    setCitations([]);
    setHandoffCitationIds([]);
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
          ...(requestedTargetSectionId ? { targetSectionId: requestedTargetSectionId } : {}),
          ...(requestedSelectionText ? { selection: requestedSelectionText } : {}),
          ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
        },
        {
          onText: (delta) => {
            setActivitySequence((sequence) => sequence + 1);
            setOutput((value) => value + delta);
            setTurns((items) =>
              items.map((turn) =>
                turn.id === turnId ? { ...turn, response: turn.response + delta } : turn,
              ),
            );
          },
          onCitation: (citation) =>
            setCitations((value) =>
              value.some((item) => item.id === citation.id) ? value : [...value, citation],
            ),
          onFinding: (finding) => setFindings((value) => [...value, finding]),
          onStatus: (next) => {
            setActivitySequence((sequence) => sequence + 1);
            const excerpts = /^(\d+) source excerpts? selected/.exec(next.detail);
            setStatus(
              excerpts
                ? `Reading ${excerpts[1]} excerpt${excerpts[1] === '1' ? '' : 's'}…`
                : next.stage === 'review'
                  ? 'Reviewing…'
                  : next.detail,
            );
          },
          onCompletion: (completion) => {
            setStatus('Writing…');
            if (requestedAction === 'review') {
              setActiveReviewGrounding(
                completion.grounding
                  ? {
                      runId: completion.runId,
                      sourceRevision: completion.revision,
                      grounding: completion.grounding,
                    }
                  : null,
              );
            }
            setTurns((items) =>
              items.map((turn) =>
                turn.id === turnId
                  ? { ...turn, runId: completion.runId, status: 'complete' }
                  : turn,
              ),
            );
            if (requestedAction === 'draft' || requestedAction === 'rewrite') {
              setProposalContext({
                sourceRunId: completion.runId,
                runId: completion.runId,
                sourceRevision: completion.revision,
                action: requestedAction,
                scope: requestedScope,
                provider: project.selectedProvider!,
                model: project.selectedModel!,
                appliedRevision: null,
                targetSectionId: requestedTargetSectionId,
                selectionText: requestedSelectionText,
                instruction: instruction.trim(),
                grounding: completion.grounding ?? null,
              });
            }
            void api.aiRuns(project.id).then((result) => setAiRuns(result.runs));
          },
        },
        controller.signal,
      );
      setAnnouncement('Response complete');
      return true;
    } catch (reasonCaught) {
      setInterrupted(true);
      setAnnouncement('Response stopped, incomplete');
      if (reasonCaught instanceof DOMException && reasonCaught.name === 'AbortError') {
        setStoppedAt(new Date().toISOString());
      } else {
        setFailure(describeFailure(reasonCaught));
      }
      return false;
    } finally {
      setBusy(false);
      setStalled(false);
      setStatus('');
      abortRef.current = null;
    }
  }

  useEffect(() => {
    if (busy || !queued) return;
    const next = queued;
    setQueued(null);
    void submitAction(next).then((sent) => {
      if (sent) setPrompt((current) => (current === next ? '' : current));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, queued]);

  function flash(sectionId: string | null) {
    if (!sectionId) return;
    setFlashSectionId(sectionId);
    window.setTimeout(
      () => setFlashSectionId((current) => (current === sectionId ? null : current)),
      650,
    );
  }

  async function applyOutput() {
    if (
      !prd ||
      !proposalContext?.runId ||
      (proposalContext.action !== 'draft' && proposalContext.action !== 'rewrite') ||
      proposalContext.sourceRevision !== prd.revision ||
      !output.trim() ||
      (groundingReviewRequired && !groundingReviewed) ||
      citations.some((citation) => !citation.available) ||
      dirty ||
      documentMutationRef.current
    )
      return;
    const { runId, sourceRevision, targetSectionId } = proposalContext;
    const sectionTitle =
      prd.sections.find((section) => section.id === targetSectionId)?.title ?? 'Whole PRD';
    const saved = await runDocumentMutation(() =>
      api.applyAiRun(project.id, runId, sourceRevision, output.trim(), groundingReviewed),
    );
    if (!saved) return;
    setUndoRevision(sourceRevision);
    setAcceptedInfo({ section: sectionTitle, revision: saved.revision });
    setPrd(saved);
    setSavedPrd(saved);
    setOutput('');
    setProposalDraft((draft) => (draft?.runId === runId ? undefined : draft));
    setProposalContext(null);
    flash(targetSectionId);
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

  function rejectProposal() {
    if (documentMutationRef.current || !proposalContext) return;
    const sectionTitle =
      prd?.sections.find((section) => section.id === proposalContext.targetSectionId)?.title ??
      'Whole PRD';
    setOutput('');
    // An empty saved text records the rejection so a reload does not reopen the proposal.
    setProposalDraft({ runId: proposalContext.sourceRunId ?? null, text: '' });
    setProposalContext(null);
    setRejectedSection(sectionTitle);
  }

  async function acceptFinding(finding: ReviewFinding) {
    if (
      !prd ||
      !finding.proposedPatch ||
      finding.sourceRevision !== prd.revision ||
      dirty ||
      documentMutationRef.current
    )
      return;
    const sourceRevision = prd.revision;
    const proposedPatch = finding.proposedPatch;
    const revised = findingDrafts[finding.id];
    const sectionTitle =
      prd.sections.find((section) => section.id === finding.targetSectionId)?.title ?? 'Section';
    const saved = await runDocumentMutation(() =>
      api.acceptFinding(
        project.id,
        finding.id,
        sourceRevision,
        revised === undefined || revised === proposedPatch.afterMarkdown ? undefined : revised,
      ),
    );
    if (!saved) return;
    setUndoRevision(sourceRevision);
    setAcceptedInfo({ section: sectionTitle, revision: saved.revision });
    setPrd(saved);
    setSavedPrd(saved);
    flash(finding.targetSectionId);
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

  async function handleFindingError(reason: unknown) {
    setError(messageFrom(reason));
    if (!(reason instanceof ClientApiError) || reason.code !== 'stale_finding') return;
    try {
      setFindings((await api.findings(project.id)).findings);
    } catch {
      setError('The finding became stale, but review state could not refresh. Reload the project.');
    }
  }

  async function undoAccepted() {
    if (
      !prd ||
      undoRevision === null ||
      prd.revision !== undoRevision + 1 ||
      dirty ||
      documentMutationRef.current
    )
      return;
    const restored = await runDocumentMutation(() =>
      api.restoreRevision(project.id, undoRevision, prd.revision),
    );
    if (!restored) return;
    setPrd(restored);
    setSavedPrd(restored);
    setUndoRevision(null);
    setAcceptedInfo(null);
    setRevisions((await api.revisions(project.id)).revisions);
  }

  async function upload(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setNotAdded((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          reason: 'Too large',
          detail: `${formatBytes(file.size)} is over the 25 MB limit`,
        },
      ]);
      return;
    }
    try {
      const source = await api.addSource(project.id, file);
      setSources((current) => [...current, source]);
      setSelectedSourceId(source.id);
    } catch (reason) {
      const entry: NotAddedFile = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        reason: 'Not added',
        detail: messageFrom(reason),
      };
      if (reason instanceof ClientApiError) {
        if (reason.code === 'duplicate_source') {
          const existing = sources.find(
            (item) => item.size === file.size && item.name === file.name,
          );
          entry.reason = 'Duplicate';
          entry.detail = existing
            ? `Same content as ${existing.name}`
            : 'Same content as a file already in Sources';
        } else if (reason.status === 413) {
          entry.reason = 'Too large';
          entry.detail = `${formatBytes(file.size)} is over the 25 MB limit`;
        } else if (reason.status === 415 || reason.code === 'unsupported_file') {
          const extension = file.name.split('.').pop() ?? '';
          entry.reason = 'Not supported';
          entry.detail = extension ? `.${extension} files can’t be read.` : reason.message;
        }
      }
      setNotAdded((current) => [...current, entry]);
    }
  }

  async function removeSource(source: SourceSummary) {
    setError('');
    try {
      await api.deleteSource(project.id, source.id);
    } catch (reason) {
      setError(messageFrom(reason));
      return;
    }
    setSources((current) => current.filter((item) => item.id !== source.id));
    setSelectedSourceId((current) => (current === source.id ? null : current));
    setEvidenceDetail(null);
    try {
      const [findingResult, runResult, handoffResult] = await Promise.all([
        api.findings(project.id),
        api.aiRuns(project.id),
        api.chatGptHandoffs(project.id),
      ]);
      const refreshedCitations = new Map(
        runResult.runs.flatMap((run) => run.citations.map((citation) => [citation.id, citation])),
      );
      setFindings(findingResult.findings);
      setAiRuns(runResult.runs);
      setHandoffs(handoffResult.handoffs);
      setCitations((current) =>
        current.map((citation) => refreshedCitations.get(citation.id) ?? citation),
      );
      setHandoffCitationIds((current) =>
        current.filter((id) => refreshedCitations.get(id)?.available),
      );
    } catch {
      setError('The source was deleted, but evidence state could not refresh. Reload the project.');
    }
  }

  async function openCitation(citation: Citation) {
    setDestinationState('sources');
    if (narrow) setSidebarOpen(false);
    if (!citation.available || !citation.sourceId || !citation.locationId) {
      setEvidenceDetail({
        sourceName: citation.sourceName,
        locator: citation.locator,
        content: '',
        excerpt: citation.excerpt,
        available: false,
      });
      return;
    }
    setSelectedSourceId(citation.sourceId);
    try {
      const location = await api.sourceLocation(project.id, citation);
      setEvidenceDetail({
        sourceName: citation.sourceName,
        locator: location.locator,
        content: location.content,
        excerpt: citation.excerpt,
        available: true,
      });
    } catch (reason) {
      setError(messageFrom(reason));
    }
  }

  async function prepareHandoff(handoffScope: ActionScope, sectionId: string | null) {
    if (!prd || !handoffInstruction.trim() || dirty || documentMutationRef.current) return null;
    const inferred = actionForInstruction(handoffInstruction, prd);
    const handoffAction = inferred === 'ask' ? 'rewrite' : inferred;
    const resolvedScope: 'document' | 'section' =
      handoffScope === 'document' ? 'document' : 'section';
    const sectionIds =
      resolvedScope === 'document'
        ? prd.sections.map((section) => section.id)
        : [sectionId ?? selectedSectionId].filter(Boolean);
    const handoff = await api.createChatGptHandoff(project.id, {
      revision: prd.revision,
      action: handoffAction,
      scope: resolvedScope,
      instruction: handoffInstruction.trim(),
      sectionIds,
      citationIds: handoffCitationIds,
    });
    setHandoffs((current) => [handoff, ...current]);
    return handoff;
  }

  async function importHandoffResponse(text: string) {
    if (documentMutationRef.current) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error('The response must be the JSON block produced by the other chat tool.');
    }
    const file = new File([JSON.stringify(parsed)], 'response.json', { type: 'application/json' });
    const handoff = await api.importChatGptHandoff(project.id, file);
    setHandoffs((current) => [handoff, ...current.filter((item) => item.id !== handoff.id)]);
    setDestination('conversation');
  }

  async function applyChatGptHandoff(handoff: ChatGptHandoffSummary) {
    if (!prd || !handoff.response || dirty || documentMutationRef.current) return;
    const configured = handoffDrafts[handoff.id] ?? {};
    const patches = handoff.response.patches.flatMap((patch) => {
      const revised = configured[patch.sectionId];
      if (revised === null) return [];
      return [{ sectionId: patch.sectionId, afterMarkdown: revised ?? patch.afterMarkdown }];
    });
    if (patches.length === 0) {
      setError('Keep at least one section change before accepting the handoff.');
      return;
    }
    const restoredRevision = prd.revision;
    const titles = patches
      .map(
        (patch) =>
          prd.sections.find((section) => section.id === patch.sectionId)?.title ?? 'Section',
      )
      .join(', ');
    const saved = await runDocumentMutation(() =>
      api.applyChatGptHandoff(project.id, handoff.id, prd.revision, patches),
    );
    if (!saved) return;
    setUndoRevision(restoredRevision);
    setAcceptedInfo({ section: titles, revision: saved.revision });
    setPrd(saved);
    setSavedPrd(saved);
    const [handoffResult, revisionResult] = await Promise.all([
      api.chatGptHandoffs(project.id),
      api.revisions(project.id),
    ]);
    setHandoffs(handoffResult.handoffs);
    setRevisions(revisionResult.revisions);
  }

  useEffect(() => () => abortRef.current?.abort(), []);

  const persistRecovery = useCallback((): Promise<boolean> => {
    const snapshot = recoverySnapshot.current;
    if (!snapshot || recoveryBlocked.current) return Promise.resolve(!recoveryBlocked.current);
    recoveryQueue.current = recoveryQueue.current.then(async () => {
      if (recoveryBlocked.current) return false;
      const fingerprint = JSON.stringify(snapshot);
      if (fingerprint === recoverySaved.current) return true;
      try {
        const saved = await api.saveWorkspace(project.id, {
          ...snapshot,
          revision: recoveryRevision.current,
        });
        recoveryRevision.current = saved.revision;
        recoverySaved.current = fingerprint;
        setRecoverySavedKey(fingerprint);
        setStorageError('');
        return true;
      } catch (reason) {
        if (reason instanceof ClientApiError && reason.code === 'workspace_conflict') {
          recoveryBlocked.current = true;
          setRecoveryUnavailable(true);
        }
        setStorageError(
          reason instanceof ClientApiError && reason.code === 'workspace_conflict'
            ? 'Another window saved this workspace. Keep this window open and copy any unsent text before reloading; the newer recovery record has not been overwritten.'
            : `Couldn’t save: ${messageFrom(reason)} Your edits are kept until you save.`,
        );
        return false;
      }
    });
    return recoveryQueue.current;
  }, [project.id]);

  useEffect(() => {
    recoverySnapshot.current = workspaceSnapshot;
    if (!workspaceSnapshot) return;
    const timer = window.setTimeout(() => {
      void persistRecovery();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [workspaceSnapshot, persistRecovery]);

  useEffect(() => {
    if (!busy) return;
    const started = performance.now();
    const timer = window.setInterval(() => setStalled(performance.now() - started > 45000), 1000);
    return () => window.clearInterval(timer);
  }, [busy, activitySequence]);

  const modalOpen =
    exportOpen || handoffOpen || createOpen || renameOpen || recoveryOpen || alert !== null;
  const saveSubtitle = saveBusy
    ? 'Edited · saving…'
    : saveFailed
      ? 'Not saved'
      : dirty
        ? 'Edited'
        : `Saved · Version ${prd?.revision ?? 0}`;
  const subtitle = (() => {
    const base = `${offline ? 'Offline · ' : ''}${saveSubtitle}`;
    switch (destination) {
      case 'sources': {
        const counted = sources.filter(countsSource);
        const reading = counted.filter((source) => source.status === 'processing').length;
        return `${counted.length} ${counted.length === 1 ? 'file' : 'files'}${reading ? ` · ${reading} reading` : ''}`;
      }
      case 'settings':
        return project.selectedModel && project.selectedProvider
          ? `In use: ${project.selectedModel} · ${providerLabels[project.selectedProvider]}`
          : 'No model chosen';
      case 'structures':
        return `This project uses ${structures.find((item) => item.id === project.selectedStructureId)?.name ?? 'the current structure'}`;
      default:
        return narrow ? `${destinationTitles[destination]} · ${base}` : base;
    }
  })();

  useEffect(() => {
    postShellState({
      title: narrow ? project.name : destinationTitles[destination],
      subtitle,
      dirty,
      busy: busy || navigationBusy,
      recoveryPending,
      modalOpen,
      hasProject: true,
    });
  }, [
    project.name,
    destination,
    subtitle,
    dirty,
    busy,
    navigationBusy,
    recoveryPending,
    modalOpen,
    narrow,
  ]);

  const toggleInspector = useCallback(() => setInspectorOpen((open) => !open), []);

  useEffect(() => {
    const command = (event: Event) => {
      switch ((event as CustomEvent<string>).detail) {
        case 'toggle-sidebar':
          setSidebarOpen((open) => !open);
          break;
        case 'toggle-inspector':
          toggleInspector();
          break;
        case 'conversation':
          setDestination('conversation');
          break;
        case 'document':
          setDestination('document');
          break;
        case 'sources':
          setDestination('sources');
          break;
        case 'history':
          setDestination('history');
          break;
        case 'structures':
          setDestination('structures');
          break;
        case 'export':
          setExportOpen(true);
          break;
        case 'settings':
          setDestination('settings');
          break;
        case 'save':
          if (dirty) void save();
          break;
        case 'new-project':
          setCreateOpen(true);
          break;
        case 'import':
          archiveInputRef.current?.click();
          break;
        case 'focus-composer':
          setDestination('conversation');
          window.setTimeout(() => composerRef.current?.focus(), 0);
          break;
      }
    };
    const download = (event: Event) => {
      const result = (event as CustomEvent<{ status: string; message?: string; file?: string }>)
        .detail;
      setExportStatus(
        result.status === 'completed'
          ? result.file
            ? `Exported “${result.file}”`
            : 'Export saved.'
          : result.status === 'cancelled'
            ? ''
            : result.message || 'Export could not finish. Try another location.',
      );
    };
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);
      const meta = event.metaKey || event.ctrlKey;
      if (event.key === 'Escape') {
        if (busy && abortRef.current) {
          abortRef.current.abort();
          return;
        }
        if (narrow && sidebarOpen) setSidebarOpen(false);
        return;
      }
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (event.altKey && key === 'a') {
        event.preventDefault();
        setDestination('conversation');
        setScopeMenuOpen(true);
        return;
      }
      if (event.altKey && key === 'm') {
        event.preventDefault();
        setDestination('conversation');
        setModelMenuOpen(true);
        return;
      }
      if (event.altKey && (key === '0' || event.code === 'Digit0')) {
        if (isNative) return;
        event.preventDefault();
        toggleInspector();
        return;
      }
      if (event.key === 'Enter' && !editing) {
        if (proposalContext && canAccept) {
          event.preventDefault();
          void applyOutput().catch((reason: unknown) => setError(messageFrom(reason)));
        }
        return;
      }
      if (event.key === 'Backspace' && !editing && proposalContext) {
        event.preventDefault();
        rejectProposal();
        return;
      }
      if (
        key === 'z' &&
        !event.shiftKey &&
        !editing &&
        undoRevision !== null &&
        prd?.revision === undoRevision + 1
      ) {
        event.preventDefault();
        void undoAccepted().catch((reason: unknown) => setError(messageFrom(reason)));
        return;
      }
      if (isNative) return;
      if (event.ctrlKey && event.metaKey && key === 's') {
        event.preventDefault();
        setSidebarOpen((open) => !open);
        return;
      }
      if (key === 's' && !event.shiftKey) {
        event.preventDefault();
        if (dirty) void save();
      } else if (key === ',' && event.shiftKey) {
        event.preventDefault();
        setDestination('structures');
      } else if (key === ',') {
        event.preventDefault();
        setDestination('settings');
      } else if (key === 'e' && event.shiftKey) {
        event.preventDefault();
        setExportOpen(true);
      } else if (key === 'o') {
        event.preventDefault();
        archiveInputRef.current?.click();
      } else if (key === 'n' && !event.shiftKey) {
        event.preventDefault();
        setCreateOpen(true);
      } else if (key === 'l') {
        event.preventDefault();
        setDestination('conversation');
        window.setTimeout(() => composerRef.current?.focus(), 0);
      } else if (['1', '2', '3', '4'].includes(event.key) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setDestination(
          (['conversation', 'document', 'sources', 'history'] as Destination[])[
            Number(event.key) - 1
          ]!,
        );
      }
    };
    window.addEventListener('prd-command', command);
    window.addEventListener('prd-download', download);
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('prd-command', command);
      window.removeEventListener('prd-download', download);
      window.removeEventListener('keydown', keyboard);
    };
  });

  const mainId =
    destination === 'document'
      ? 'prd-editor'
      : destination === 'conversation'
        ? 'conversation-workspace'
        : `destination-${destination}`;
  useEffect(() => {
    document.getElementById(mainId)?.focus({ preventScroll: true });
  }, [mainId]);

  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(''), 4000);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const scrollers = element.querySelectorAll<HTMLElement>(
      '.conversation-scroll, .document, .split-list, .split-detail, .sources-list',
    );
    const update = () =>
      setToolbarScrolled(Array.from(scrollers).some((node) => node.scrollTop > 0));
    update();
    scrollers.forEach((node) => node.addEventListener('scroll', update, { passive: true }));
    return () => scrollers.forEach((node) => node.removeEventListener('scroll', update));
  }, [destination, turns.length, workspaceLoaded]);

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setDestination('sources');
    setUploading(true);
    setError('');
    try {
      for (const file of files) await upload(file);
    } finally {
      setUploading(false);
    }
  }

  async function leaveWorkspace(operation: () => Promise<void> | void, reason: string) {
    if (navigationRef.current || documentMutationRef.current) return;
    if (busy) {
      setError(
        'Stop the current response before leaving this project. Your instruction will be kept.',
      );
      return;
    }
    if (recoveryConflict) {
      setRecoveryOpen(true);
      return;
    }
    if (recoveryUnavailable && recoveryPending) {
      setError(
        'Keep this window open until recovery is saved. Copy any new text before reloading.',
      );
      return;
    }
    navigationRef.current = true;
    setNavigationBusy(true);
    try {
      if (dirty && !(await save(reason))) return;
      if (!recoveryUnavailable && !(await persistRecovery())) return;
      await operation();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      navigationRef.current = false;
      setNavigationBusy(false);
    }
  }

  const registerEditor = useCallback((sectionId: string, editor: Editor | null) => {
    if (editor) editors.current.set(sectionId, editor);
    else editors.current.delete(sectionId);
  }, []);

  const onStatesChange = useCallback(
    (states: ProviderState[]) => {
      setActiveProviderState(
        states.find((item) => item.provider === project.selectedProvider) ?? null,
      );
    },
    [project.selectedProvider],
  );

  const updateStructure = useCallback(
    async (id: string, patch: { name?: string; sections?: StructureSection[] }) => {
      const updated = await api.updateStructure(project.id, id, patch);
      setStructures((current) => current.map((item) => (item.id === id ? updated : item)));
    },
    [project.id],
  );

  if (!prd || !workspaceLoaded) {
    return (
      <main className="boot-state" aria-busy={!error}>
        <BookOpen aria-hidden="true" />
        <p>{error || 'Opening project…'}</p>
        {error && (
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Retry
          </button>
        )}
      </main>
    );
  }

  const currentPrd = prd;
  const editingDisabled = documentMutationBusy || recoveryUnavailable || Boolean(recoveryConflict);
  const proposalTargetSection = proposalContext?.targetSectionId
    ? currentPrd.sections.find((section) => section.id === proposalContext.targetSectionId)
    : undefined;
  const proposalSectionTitle =
    proposalContext?.scope === 'document'
      ? 'Whole PRD'
      : (proposalTargetSection?.title ?? 'Removed section');
  const proposalStale = Boolean(
    proposalContext && proposalContext.sourceRevision !== currentPrd.revision,
  );
  const proposalInvalid = citations.some((citation) => !citation.available);
  const canAccept = Boolean(
    proposalContext?.runId &&
    !proposalStale &&
    !proposalInvalid &&
    output.trim() &&
    !(groundingReviewRequired && !groundingReviewed) &&
    !busy &&
    !dirty &&
    !documentMutationBusy,
  );
  const emptySections = currentPrd.sections.filter((section) => !section.body.trim());
  const requiredEmpty = emptySections.filter((section) => section.required);
  const readySources = sources.filter(
    (source) => source.status === 'ready' || source.status === 'partial',
  );
  const latestReview = [...aiRuns]
    .filter((run) => run.action === 'review')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const activeStructureName =
    structures.find((item) => item.id === project.selectedStructureId)?.name ??
    (currentPrd.sections.every((section) =>
      DEFAULT_STRUCTURE_SECTIONS.some((item) => item.title === section.title),
    ) && currentPrd.sections.length === DEFAULT_STRUCTURE_SECTIONS.length
      ? 'Default'
      : 'Current');
  const builtIn: StructureEntry = {
    id: BUILT_IN_STRUCTURE_ID,
    name: 'Default PRD',
    sections: [...DEFAULT_STRUCTURE_SECTIONS],
    builtIn: true,
  };
  const inspectorAvailable =
    (destination === 'conversation' || destination === 'document') && !narrow;
  const showInspector = inspectorAvailable && inspectorOpen;
  const sidebarMode = narrow ? 'overlay' : 'docked';
  const activeEditor = editors.current.get(selectedSectionId) ?? null;

  const suggestions = (() => {
    const list: Array<{ icon: typeof SearchCheck; text: string }> = [];
    const sourceName = readySources[0]?.name;
    const material = sourceName ? `from ${sourceName}` : 'from my notes';
    list.push({ icon: SearchCheck, text: 'Review the whole PRD for gaps and contradictions' });
    const toDraft = (requiredEmpty.length ? requiredEmpty : emptySections)
      .slice(0, 2)
      .map((section) => section.title);
    list.push({
      icon: PenLine,
      text: toDraft.length
        ? `Draft ${toDraft.join(' and ')} ${material}`
        : `Draft a summary of the PRD ${material}`,
    });
    list.push({
      icon: CircleHelp,
      text: sourceName
        ? `List the open questions ${sourceName} raises`
        : 'List the open questions this PRD leaves',
    });
    const requirements = currentPrd.sections.find(
      (section) => /requirement/i.test(section.title) && section.body.trim(),
    );
    const filled = currentPrd.sections.find((section) => section.body.trim());
    list.push({
      icon: ListChecks,
      text: `Tighten ${(requirements ?? filled)?.title ?? 'the first section'}${requirements ? '' : ' and make it testable'}`,
    });
    return list;
  })();

  function applyStructure(entry: StructureEntry) {
    void (async () => {
      try {
        if (recoveryUnavailable)
          throw new Error('Reload when recovery is available before changing structure.');
        if (recoveryConflict) throw new Error('Review recovered edits before changing structure.');
        const current = dirty ? await save('Saved before structure change') : currentPrd;
        if (!current) throw new Error('Save the current document before changing its structure.');
        let structureId = entry.id;
        if (entry.builtIn) {
          const existing = structures.find((item) => item.name === entry.name);
          if (existing) structureId = existing.id;
          else {
            const created = await api.createStructure(project.id, {
              name: entry.name,
              sections: entry.sections,
            });
            setStructures((items) => [...items, created]);
            structureId = created.id;
          }
        }
        const result = await api.selectStructure(project.id, structureId, current.revision);
        setPrd(result.prd);
        setSavedPrd(result.prd);
        setSelectedSectionId(result.prd.sections[0]?.id ?? '');
        onProjectChange(result.project);
        setStructureSelection(structureId);
        setRevisions((await api.revisions(project.id)).revisions);
      } catch (reason) {
        setError(messageFrom(reason));
      }
    })();
  }

  function renderTurnMeta(turn: WorkspaceTurn | null, run: AiRunProposal | undefined) {
    const model = run?.model ?? project.selectedModel ?? '';
    const provider = run
      ? providerLabels[run.provider]
      : project.selectedProvider
        ? providerLabels[project.selectedProvider]
        : '';
    const time = run ? formatTime(run.startedAt) : turn ? '' : formatTime(new Date());
    return [model, provider, time].filter(Boolean).join(' · ');
  }

  function proposalDiff(): ReactNode {
    if (!proposalContext) return null;
    if (proposalContext.scope === 'document') {
      const blocks = output.trim().split(/(?=<!--\s*section:)/i);
      const bySection = new Map<string, string>();
      for (const block of blocks) {
        const match =
          /^<!--\s*section:([0-9a-f-]{36})\s*-->\s*\r?\n##[ \t]+[^\r\n]+\r?\n([\s\S]*)$/i.exec(
            block.trim(),
          );
        if (match) bySection.set(match[1]!, (match[2] ?? '').trim());
      }
      if (bySection.size === 0) return <DiffView lines={lineDiff('', output)} />;
      return (
        <div className="patch-list">
          {currentPrd.sections.map((section, index) => {
            const after = bySection.get(section.id);
            if (after === undefined || after === section.body.trim()) return null;
            return (
              <div key={section.id} className="section-diff">
                <strong style={{ fontSize: 13 }}>
                  {sectionNumber(index)} {section.title}
                </strong>
                <DiffView lines={lineDiff(section.body, after)} />
              </div>
            );
          })}
        </div>
      );
    }
    const before =
      proposalContext.scope === 'selection'
        ? (proposalContext.selectionText ?? '')
        : (proposalTargetSection?.body ?? '');
    return <DiffView lines={lineDiff(before, output)} />;
  }

  function renderProposalCard(): ReactNode {
    if (!proposalContext || !output || busy) return null;
    const ariaLabel = `Proposed change to ${proposalSectionTitle}`;
    const index = proposalTargetSection ? currentPrd.sections.indexOf(proposalTargetSection) : -1;
    const title = `Proposed change · ${index >= 0 ? `${sectionNumber(index)} ` : ''}${proposalSectionTitle}`;
    if (proposalInvalid) {
      return (
        <ProposalCard
          ariaLabel={ariaLabel}
          title={title}
          meta={`Based on Version ${proposalContext.sourceRevision}`}
        >
          <InvalidCitationRow
            disabled={documentMutationBusy}
            onRegenerate={proposalContext.instruction ? () => void regenerate() : undefined}
            onDismiss={rejectProposal}
          />
        </ProposalCard>
      );
    }
    if (proposalStale) {
      return (
        <ProposalCard
          ariaLabel={ariaLabel}
          title={title}
          meta={`Based on Version ${proposalContext.sourceRevision}`}
        >
          <StaleRow
            basedOn={proposalContext.sourceRevision}
            section={proposalSectionTitle}
            disabled={documentMutationBusy}
            onRegenerate={proposalContext.instruction ? () => void regenerate() : undefined}
            onDismiss={rejectProposal}
          />
        </ProposalCard>
      );
    }
    const reasons = proposalContext.grounding?.reasons.length ?? 0;
    const footNote =
      groundingReviewRequired && !groundingReviewed
        ? `Review ${reasons || 1} statement${reasons === 1 ? '' : 's'} to accept this change.`
        : dirty
          ? 'Save your edits in Document (⌘S) to accept this change.'
          : !proposalContext.grounding
            ? 'No grounding check was saved for this proposal. Compare it with your sources before accepting.'
            : 'Accepting creates a new version.';
    return (
      <ProposalCard
        ariaLabel={ariaLabel}
        title={title}
        meta={`Based on Version ${proposalContext.sourceRevision}`}
        footNote={footNote}
        footTone={groundingReviewRequired && !groundingReviewed ? 'warning' : undefined}
        actions={
          <>
            <button
              type="button"
              className="btn"
              disabled={documentMutationBusy}
              onClick={rejectProposal}
            >
              Reject
            </button>
            <button
              type="button"
              className="btn btn-primary"
              aria-disabled={!canAccept}
              disabled={!canAccept}
              title={!canAccept ? footNote : undefined}
              onClick={() =>
                void applyOutput().catch((reason: unknown) => setError(messageFrom(reason)))
              }
            >
              Accept change
            </button>
          </>
        }
      >
        {proposalContext.selectionText && (
          <p className="t-secondary">
            Selected text: “{truncateText(proposalContext.selectionText)}”
          </p>
        )}
        {proposalDiff()}
        {citations.length > 0 && (
          <div className="citation-list" style={{ marginTop: 8 }}>
            {citations.map((citation, citationIndex) => (
              <button key={citation.id} type="button" onClick={() => void openCitation(citation)}>
                <b>{citationIndex + 1}</b> {citation.sourceName} · {citation.locator}
              </button>
            ))}
          </div>
        )}
        {groundingReviewRequired && proposalContext.grounding && (
          <ReviewBlock
            assessment={proposalContext.grounding}
            citations={citations}
            onOpenCitation={(citation) => void openCitation(citation)}
          >
            <label className="check">
              <input
                type="checkbox"
                checked={groundingReviewed}
                disabled={documentMutationBusy || recoveryUnavailable}
                onChange={(event) =>
                  setGroundingAcknowledgement(
                    event.target.checked ? { context: proposalContext, text: output } : null,
                  )
                }
              />
              I reviewed the supporting material and this proposal&apos;s claims.
            </label>
          </ReviewBlock>
        )}
        <details className="proposal-edit">
          <summary>Edit…</summary>
          <textarea
            className="field"
            aria-label="Revised AI proposal"
            value={output}
            disabled={documentMutationBusy || recoveryUnavailable}
            onChange={(event) => {
              if (documentMutationRef.current || recoveryUnavailable) return;
              if (
                proposalDraft &&
                proposalDraft.runId !== proposalContext.sourceRunId &&
                !window.confirm(
                  'Replace your saved edits to the other proposal? Cancel to keep them in History.',
                )
              )
                return;
              setOutput(event.target.value);
              setGroundingAcknowledgement(null);
              setProposalDraft({
                runId: proposalContext.sourceRunId ?? null,
                text: event.target.value,
              });
            }}
          />
        </details>
      </ProposalCard>
    );
  }

  async function regenerate() {
    if (!proposalContext?.instruction) return;
    const { instruction, scope: runScope, targetSectionId } = proposalContext;
    setScope(runScope === 'selection' ? 'section' : runScope, targetSectionId);
    await submitAction(instruction, {
      action: proposalContext.action,
      scope: runScope === 'selection' ? 'section' : runScope,
      targetSectionId,
    });
  }

  function renderFindingCard(finding: ReviewFinding): ReactNode {
    const index = currentPrd.sections.findIndex(
      (section) => section.id === finding.targetSectionId,
    );
    const sectionTitle = index >= 0 ? currentPrd.sections[index]!.title : 'Removed section';
    const open = finding.status === 'open';
    const stale = finding.sourceRevision !== currentPrd.revision;
    const statusLabel =
      finding.status === 'accepted'
        ? 'Accepted'
        : finding.status === 'dismissed'
          ? 'Rejected'
          : finding.status === 'stale' || stale
            ? 'Out of date'
            : '';
    return (
      <ProposalCard
        key={finding.id}
        className={`finding finding-${finding.severity}`}
        ariaLabel={`Proposed change to ${sectionTitle}`}
        title={`Proposed change · ${index >= 0 ? `${sectionNumber(index)} ` : ''}${sectionTitle}`}
        meta={`Based on Version ${finding.sourceRevision}`}
        footNote={
          open && !stale
            ? dirty
              ? 'Save your edits in Document (⌘S) to accept this change.'
              : `${finding.severity === 'blocking' ? 'Blocking' : finding.severity === 'warning' ? 'Warning' : 'Note'} · ${finding.category.replace('-', ' ')}`
            : `Status: ${finding.status}${statusLabel ? ` · ${statusLabel}` : ''}`
        }
        actions={
          open && !stale ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={documentMutationBusy}
                onClick={() => {
                  if (documentMutationRef.current) return;
                  void api
                    .dismissFinding(project.id, finding.id)
                    .then(() =>
                      setFindings((current) =>
                        current.map((item) =>
                          item.id === finding.id ? { ...item, status: 'dismissed' } : item,
                        ),
                      ),
                    )
                    .catch((reason: unknown) => setError(messageFrom(reason)));
                }}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!finding.proposedPatch || dirty || documentMutationBusy}
                onClick={() =>
                  void acceptFinding(finding).catch(
                    (reason: unknown) => void handleFindingError(reason),
                  )
                }
              >
                Accept change
              </button>
            </>
          ) : undefined
        }
      >
        <p className="turn-text" style={{ fontSize: 13, lineHeight: '20px' }}>
          {finding.rationale}
        </p>
        {finding.proposedPatch && (
          <DiffView
            lines={lineDiff(
              finding.proposedPatch.beforeMarkdown,
              finding.proposedPatch.afterMarkdown,
            )}
          />
        )}
        {finding.citations.length > 0 && (
          <div className="citation-list" style={{ marginTop: 8 }} aria-label="Finding evidence">
            {finding.citations.map((citation, citationIndex) => (
              <button key={citation.id} type="button" onClick={() => void openCitation(citation)}>
                <b>{citationIndex + 1}</b> {citation.sourceName} · {citation.locator}
                {citation.available ? '' : ' · source removed'}
              </button>
            ))}
          </div>
        )}
        {open && !stale && finding.proposedPatch && (
          <details className="proposal-edit finding-revision">
            <summary>Edit…</summary>
            <textarea
              className="field"
              aria-label="Revised finding"
              value={findingDrafts[finding.id] ?? finding.proposedPatch.afterMarkdown}
              disabled={documentMutationBusy || recoveryUnavailable}
              onChange={(event) => {
                if (documentMutationRef.current || recoveryUnavailable) return;
                setFindingDrafts((current) => ({ ...current, [finding.id]: event.target.value }));
              }}
            />
          </details>
        )}
      </ProposalCard>
    );
  }

  function renderHandoffCard(handoff: ChatGptHandoffSummary): ReactNode {
    if (!handoff.response) return null;
    const stale = handoff.status === 'stale' || handoff.sourceRevision !== currentPrd.revision;
    const titles = handoff.response.patches
      .map(
        (patch) =>
          currentPrd.sections.find((section) => section.id === patch.sectionId)?.title ??
          'Removed section',
      )
      .join(', ');
    return (
      <ProposalCard
        key={handoff.id}
        className="handoff-row"
        ariaLabel={`Proposed change to ${titles || 'the PRD'} from a manual handoff`}
        title={`Manual handoff · ${titles || 'No section changes'}`}
        meta={`Based on Version ${handoff.sourceRevision}`}
        footNote={
          handoff.status === 'staged' && !stale
            ? dirty
              ? 'Save your edits in Document (⌘S) to accept this change.'
              : 'Keep the sections you want, then accept. Accepting creates a new version.'
            : undefined
        }
        actions={
          handoff.status === 'staged' && !stale ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={documentMutationBusy}
                onClick={() => {
                  if (documentMutationRef.current) return;
                  void api
                    .dismissChatGptHandoff(project.id, handoff.id)
                    .then(() =>
                      setHandoffs((current) => current.filter((item) => item.id !== handoff.id)),
                    )
                    .catch((reason: unknown) => setError(messageFrom(reason)));
                }}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={dirty || documentMutationBusy}
                onClick={() =>
                  void applyChatGptHandoff(handoff).catch((reason: unknown) =>
                    setError(messageFrom(reason)),
                  )
                }
              >
                Accept change
              </button>
            </>
          ) : undefined
        }
      >
        <p className="turn-text" style={{ fontSize: 13, lineHeight: '20px' }}>
          {handoff.response.summary}
        </p>
        {stale && (
          <StaleRow
            basedOn={handoff.sourceRevision}
            section={titles || 'The PRD'}
            disabled={documentMutationBusy}
            onDismiss={() => {
              void api
                .dismissChatGptHandoff(project.id, handoff.id)
                .then(() =>
                  setHandoffs((current) => current.filter((item) => item.id !== handoff.id)),
                )
                .catch((reason: unknown) => setError(messageFrom(reason)));
            }}
          />
        )}
        {!stale && (
          <div className="patch-list">
            {handoff.response.patches.map((patch) => {
              const configured = handoffDrafts[handoff.id]?.[patch.sectionId];
              const enabled = configured !== null;
              const section = currentPrd.sections.find((item) => item.id === patch.sectionId);
              const editable = handoff.status === 'staged';
              return (
                <div key={patch.sectionId} className="section-diff">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={documentMutationBusy || recoveryUnavailable || !editable}
                      onChange={(event) => {
                        if (documentMutationRef.current || recoveryUnavailable) return;
                        setHandoffDrafts((current) => ({
                          ...current,
                          [handoff.id]: {
                            ...current[handoff.id],
                            [patch.sectionId]: event.target.checked ? patch.afterMarkdown : null,
                          },
                        }));
                      }}
                    />
                    {section?.title ?? 'Removed section'}
                  </label>
                  <DiffView
                    lines={lineDiff(section?.body ?? '', configured ?? patch.afterMarkdown)}
                  />
                  {editable && (
                    <details className="proposal-edit">
                      <summary>Edit…</summary>
                      <textarea
                        className="field"
                        aria-label={`Revised change to ${section?.title ?? 'section'}`}
                        disabled={documentMutationBusy || recoveryUnavailable || !enabled}
                        value={configured ?? patch.afterMarkdown}
                        onChange={(event) => {
                          if (documentMutationRef.current || recoveryUnavailable) return;
                          setHandoffDrafts((current) => ({
                            ...current,
                            [handoff.id]: {
                              ...current[handoff.id],
                              [patch.sectionId]: event.target.value,
                            },
                          }));
                        }}
                      />
                    </details>
                  )}
                </div>
              );
            })}
            {handoff.response.findings.map((finding, index) => (
              <p key={`${handoff.id}-${index}`} className="t-secondary">
                {finding.severity}: {finding.category.replace('-', ' ')}. {finding.rationale}
              </p>
            ))}
          </div>
        )}
      </ProposalCard>
    );
  }

  const composerProps = {
    value: prompt,
    onChange: (value: string) => {
      setPrompt(value);
      setDraftRestored(false);
    },
    onSend: (text: string) => {
      void submitAction(text).then((sent) => {
        if (sent) setPrompt((current) => (current === text ? '' : current));
      });
    },
    onStop: () => abortRef.current?.abort(),
    busy,
    disabled: documentMutationBusy || recoveryUnavailable,
    offline,
    runningStatus: stalled
      ? 'Still waiting for the provider. You can stop safely; your instruction is kept.'
      : status,
    scope,
    targetSectionId: scope === 'document' ? null : selectedSectionId || null,
    selection,
    sections: currentPrd.sections,
    onScopeChange: (next: ActionScope, targetSectionId: string | null) => {
      if (documentMutationRef.current) return;
      setScope(next, targetSectionId);
    },
    project,
    activeState: activeProviderState,
    onProjectChange,
    onOpenSettings: () => setDestination('settings'),
    scopeMenuOpen,
    onScopeMenuOpenChange: setScopeMenuOpen,
    modelMenuOpen,
    onModelMenuOpenChange: setModelMenuOpen,
    reduceMotion,
  };

  const pendingHandoffs = handoffs.filter(
    (handoff) => handoff.response && handoff.status !== 'applied' && handoff.status !== 'dismissed',
  );
  const acceptedVisible =
    acceptedInfo !== null && undoRevision !== null && currentPrd.revision === undoRevision + 1;
  const conversationEmpty =
    turns.length === 0 &&
    !output &&
    !busy &&
    !interrupted &&
    !acceptedVisible &&
    !rejectedSection &&
    pendingHandoffs.length === 0 &&
    findings.length === 0;
  const placeholder =
    turns.length > 0 || output
      ? 'Reply, or ask for another change'
      : 'Ask for a draft, an edit, a review or an answer';

  function banner(): ReactNode {
    if (saveFailed)
      return (
        <div className="banner danger" role="alert">
          <CircleX aria-hidden="true" />
          <span>Couldn’t save: {saveFailed} Your edits are kept until you save.</span>
          <button type="button" className="btn-link" onClick={() => void save()}>
            Try again
          </button>
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setExportFormat('archive');
              setExportOpen(true);
            }}
          >
            Save a copy…
          </button>
        </div>
      );
    if (storageError)
      return (
        <div className="banner danger" role="alert">
          <CircleX aria-hidden="true" />
          <span>{storageError}</span>
          {!recoveryUnavailable && (
            <button type="button" className="btn-link" onClick={() => void persistRecovery()}>
              Try again
            </button>
          )}
        </div>
      );
    if (error)
      return (
        <div className="banner danger" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Dismiss"
            onClick={() => setError('')}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      );
    if (recoveryConflict) {
      const latest = recoveryConflict.sections
        .map((section) => section.updatedAt)
        .sort()
        .at(-1);
      return (
        <div className="banner warning" role="alert">
          <LifeBuoy aria-hidden="true" />
          <span>
            Recovered unsaved edits{latest ? ` from ${formatTime(latest)}` : ''}. Version{' '}
            {currentPrd.revision} is newer.
          </span>
          <button type="button" className="btn-link" onClick={() => setRecoveryOpen(true)}>
            Compare
          </button>
          <button
            type="button"
            className="btn-link"
            onClick={() => setAlert({ kind: 'discard-recovery' })}
          >
            Keep Version {currentPrd.revision}
          </button>
          <button
            type="button"
            className="btn-link"
            disabled={busy || documentMutationBusy}
            onClick={() => {
              const sections = recoveryConflict.sections;
              setRecoveryConflict(null);
              setRecoveryOpen(false);
              setPrd({ ...currentPrd, sections });
              setDestination('document');
            }}
          >
            Save edits as Version {currentPrd.revision + 1}
          </button>
        </div>
      );
    }
    if (offline)
      return (
        <div className="banner" role="status">
          <WifiOff aria-hidden="true" />
          <span>
            You’re offline. Editing, history and export still work. Models on this Mac still work.
          </span>
        </div>
      );
    if (project.selectedProvider === 'chatgpt' && activeProviderState?.error)
      return (
        <div className="banner warning" role="status">
          <TriangleAlert aria-hidden="true" />
          <span>ChatGPT sign-in expired. Sign in again to use your ChatGPT plan.</span>
          <button type="button" className="btn-link" onClick={() => setDestination('settings')}>
            Sign in…
          </button>
        </div>
      );
    if (importNotice)
      return (
        <div className="banner warning" role="status">
          <CircleAlert aria-hidden="true" />
          <span>{importNotice}</span>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Dismiss"
            onClick={onDismissImportNotice}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      );
    if (exportStatus)
      return (
        <div className="banner" role="status">
          <span>{exportStatus}</span>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Dismiss"
            onClick={() => setExportStatus('')}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      );
    if (recoveryStatus)
      return (
        <div className="banner" role="status">
          <LifeBuoy aria-hidden="true" />
          <span>{recoveryStatus}</span>
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setDestination('document');
              setRecoveryStatus('');
            }}
          >
            Review document
          </button>
        </div>
      );
    return null;
  }

  const formatButtons = activeEditor
    ? [
        {
          label: 'Bold',
          icon: Bold,
          active: activeEditor.isActive('bold'),
          run: () => activeEditor.chain().focus().toggleBold().run(),
        },
        {
          label: 'Italic',
          icon: Italic,
          active: activeEditor.isActive('italic'),
          run: () => activeEditor.chain().focus().toggleItalic().run(),
        },
        {
          label: 'Bulleted list',
          icon: List,
          active: activeEditor.isActive('bulletList'),
          run: () => activeEditor.chain().focus().toggleBulletList().run(),
        },
        {
          label: 'Numbered list',
          icon: ListOrdered,
          active: activeEditor.isActive('orderedList'),
          run: () => activeEditor.chain().focus().toggleOrderedList().run(),
        },
      ]
    : [];

  function viewActions(): ReactNode {
    switch (destination) {
      case 'document':
        return (
          <div
            className="toolbar-view-actions"
            role="toolbar"
            aria-label="Text formatting"
            onMouseDown={(event) => {
              // Keep the editor selection while a formatting button is pressed.
              if (event.button === 0) event.preventDefault();
            }}
          >
            {formatButtons.map(({ label, icon: Icon, active, run }) => (
              <button
                key={label}
                type="button"
                className="btn btn-icon"
                aria-label={label}
                aria-pressed={active}
                disabled={editingDisabled || !activeEditor}
                onClick={run}
              >
                <Icon aria-hidden="true" />
              </button>
            ))}
            <button
              type="button"
              className="btn btn-icon"
              aria-label="Undo editor change"
              disabled={editingDisabled || !activeEditor?.can().undo()}
              onClick={() => activeEditor?.chain().focus().undo().run()}
            >
              <Undo2 aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-icon"
              aria-label="Redo editor change"
              disabled={editingDisabled || !activeEditor?.can().redo()}
              onClick={() => activeEditor?.chain().focus().redo().run()}
            >
              <Redo2 aria-hidden="true" />
            </button>
            {dirty && (
              <button
                type="button"
                className="btn"
                style={{ marginLeft: 8 }}
                disabled={saveBusy || documentMutationBusy}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => void save()}
              >
                {saveBusy ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        );
      case 'sources':
        return (
          <button
            type="button"
            className="btn"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus aria-hidden="true" />
            <span>Add files…</span>
          </button>
        );
      case 'history':
        return (
          <button
            type="button"
            className="btn"
            disabled={documentMutationBusy}
            onClick={() => setHandoffOpen(true)}
          >
            <ArrowLeftRight aria-hidden="true" />
            <span>Manual handoff…</span>
          </button>
        );
      case 'structures': {
        const selectedEntry: StructureEntry | null =
          structureSelection === BUILT_IN_STRUCTURE_ID
            ? builtIn
            : (() => {
                const found = structures.find((item) => item.id === structureSelection);
                return found
                  ? { id: found.id, name: found.name, sections: found.sections, builtIn: false }
                  : null;
              })();
        return (
          <>
            <button
              type="button"
              className="btn"
              disabled={documentMutationBusy}
              onClick={() => {
                void api
                  .createStructure(project.id, {
                    name: `Structure ${structures.length + 1}`,
                    sections: [{ ...DEFAULT_STRUCTURE_SECTIONS[0]! }],
                  })
                  .then((created) => {
                    setStructures((current) => [...current, created]);
                    setStructureSelection(created.id);
                  })
                  .catch((reason: unknown) => setError(messageFrom(reason)));
              }}
            >
              <Plus aria-hidden="true" />
              <span>New structure</span>
            </button>
            <button
              type="button"
              className="btn"
              disabled={
                !selectedEntry ||
                documentMutationBusy ||
                (!selectedEntry.builtIn && selectedEntry.id === project.selectedStructureId)
              }
              onClick={() =>
                selectedEntry && setAlert({ kind: 'use-structure', entry: selectedEntry })
              }
            >
              Use for this project…
            </button>
          </>
        );
      }
      default:
        return null;
    }
  }

  const inspectorLabel = destination === 'document' ? 'Assistant' : 'PRD inspector';

  return (
    <div
      inert={navigationBusy}
      aria-busy={navigationBusy}
      className={`workbench ${isNative ? 'native-workbench' : ''}`}
      data-sidebar={sidebarMode}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          void uploadFiles(Array.from(event.dataTransfer.files));
        }
      }}
    >
      <a className="skip-link" href={`#${mainId}`}>
        Skip to content
      </a>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
      {sidebarOpen && narrow && (
        <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}
      {sidebarOpen && (
        <Sidebar
          projects={projects}
          project={project}
          destination={destination}
          sections={currentPrd.sections}
          selectedSectionId={selectedSectionId}
          pendingSectionId={
            proposalContext && !proposalStale && output ? proposalContext.targetSectionId : null
          }
          sourceCount={sources.filter(countsSource).length}
          width={narrow ? 240 : sidebarWidth}
          overlay={narrow}
          disabled={documentMutationBusy}
          onNavigate={setDestination}
          onSelectSection={(id) => {
            setSelectedSectionId(id);
            setDestination('document');
          }}
          onProjectSelect={(id) =>
            void leaveWorkspace(() => onProjectSelect(id), 'Saved before switching projects')
          }
          onNewProject={() => setCreateOpen(true)}
          onImport={() => archiveInputRef.current?.click()}
          onRename={() => {
            setRenameValue(project.name);
            setRenameOpen(true);
          }}
          onDelete={() => setAlert({ kind: 'delete-project' })}
          onHide={() => setSidebarOpen(false)}
          onWidthChange={setSidebarWidth}
        />
      )}
      <div className="workbench-main">
        <header className="toolbar" data-scrolled={toolbarScrolled}>
          {!sidebarOpen && (
            <div className="toolbar-leading">
              <button
                type="button"
                className="btn btn-icon"
                aria-label="Show sidebar"
                aria-expanded="false"
                aria-keyshortcuts="Control+Meta+S"
                onClick={() => setSidebarOpen(true)}
              >
                <PanelLeft aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="toolbar-title project-title">
            <strong title={narrow ? project.name : undefined}>
              {narrow ? project.name : destinationTitles[destination]}
            </strong>
            <small role="status">{subtitle}</small>
          </div>
          {destination === 'history' && (
            <div className="toolbar-center">
              <div className="segmented" role="group" aria-label="History view">
                <button
                  type="button"
                  aria-pressed={historyTab === 'revisions'}
                  onClick={() => setHistoryTab('revisions')}
                >
                  Revisions
                </button>
                <button
                  type="button"
                  aria-pressed={historyTab === 'runs'}
                  onClick={() => setHistoryTab('runs')}
                >
                  AI runs
                </button>
              </div>
            </div>
          )}
          <div className="toolbar-actions">
            {viewActions()}
            {inspectorAvailable && (
              <button
                type="button"
                className="btn btn-icon"
                aria-label={`${showInspector ? 'Hide' : 'Show'} ${inspectorLabel}`}
                aria-pressed={showInspector}
                aria-keyshortcuts="Alt+Meta+0"
                onClick={toggleInspector}
              >
                <PanelRight aria-hidden="true" />
              </button>
            )}
            <button
              ref={exportButtonRef}
              type="button"
              className="btn toolbar-export"
              aria-label="Export"
              aria-keyshortcuts="Shift+Meta+E"
              disabled={documentMutationBusy}
              onClick={() => setExportOpen(true)}
            >
              <Share aria-hidden="true" />
              <span>Export</span>
            </button>
          </div>
        </header>
        {banner()}
        <div className="content" ref={contentRef}>
          {destination === 'conversation' && (
            <main
              id="conversation-workspace"
              className="conversation"
              tabIndex={-1}
              aria-label="Conversation"
            >
              <h1 className="visually-hidden">Conversation</h1>
              {conversationEmpty ? (
                <div className="conversation-empty">
                  <div className="conversation-empty-inner">
                    <div className="conversation-status">
                      <strong>Continue the PRD</strong>
                      <span>
                        {currentPrd.sections.length} sections, {emptySections.length} empty (
                        {requiredEmpty.length} required) · {readySources.length}{' '}
                        {readySources.length === 1 ? 'source' : 'sources'} ready
                      </span>
                    </div>
                    <ul className="suggestions" aria-label="Suggestions">
                      {suggestions.map(({ icon: Icon, text }) => (
                        <li key={text}>
                          <button
                            type="button"
                            onClick={() => {
                              setPrompt(text);
                              setDraftRestored(false);
                              composerRef.current?.focus();
                            }}
                          >
                            <Icon aria-hidden="true" />
                            {text}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <Composer
                      {...composerProps}
                      placeholder={placeholder}
                      textareaRef={composerRef}
                    />
                    <span className="t-secondary composer-caption">
                      {draftRestored ? 'Draft restored. ' : ''}A suggestion fills the composer.
                      Nothing is sent until you press Send (⌘↩).
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="conversation-scroll">
                    <div className="conversation-column">
                      {turns
                        .filter((turn) => turn.id !== activeTurnId)
                        .map((turn) => {
                          const run = aiRuns.find((item) => item.id === turn.runId);
                          return (
                            <div key={turn.id} className="turn-assistant" style={{ gap: 20 }}>
                              <div className="turn-user">{turn.request || 'Document action'}</div>
                              <div className="turn-assistant">
                                <span className="turn-meta">{renderTurnMeta(turn, run)}</span>
                                <div className="turn-text">
                                  <MessageResponse>
                                    {turn.response ||
                                      (turn.status === 'complete'
                                        ? run?.action === 'review'
                                          ? 'Review complete.'
                                          : 'Reply complete.'
                                        : '')}
                                  </MessageResponse>
                                </div>
                                {turn.status === 'interrupted' && (
                                  <div className="turn-state">
                                    <span className="pill">Incomplete</span>
                                    <span className="t-secondary">
                                      Incomplete responses can’t be applied.
                                    </span>
                                  </div>
                                )}
                                {run && run.action !== 'review' && run.appliedRevision !== null && (
                                  <AcceptedRow
                                    section={
                                      currentPrd.sections.find(
                                        (section) => section.id === run.targetSectionId,
                                      )?.title ?? 'Whole PRD'
                                    }
                                    revision={run.appliedRevision}
                                  />
                                )}
                                {run &&
                                  (run.action === 'draft' || run.action === 'rewrite') &&
                                  run.appliedRevision === null &&
                                  run.outputText &&
                                  run.id !== proposalContext?.sourceRunId && (
                                    <button
                                      type="button"
                                      className="btn-link"
                                      style={{ alignSelf: 'flex-start' }}
                                      disabled={busy || documentMutationBusy}
                                      onClick={() => inspectRun(run)}
                                    >
                                      Review this proposal
                                    </button>
                                  )}
                                {run && run.id === latestReview?.id && findings.length > 0 && (
                                  <div className="patch-list" style={{ marginTop: 8 }}>
                                    {findings.map(renderFindingCard)}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      {(submittedPrompt || activeTurnId) && (
                        <>
                          {(() => {
                            const activeTurn =
                              turns.find((turn) => turn.id === activeTurnId) ?? null;
                            const request = submittedPrompt || activeTurn?.request || '';
                            return request ? <div className="turn-user">{request}</div> : null;
                          })()}
                        </>
                      )}
                      {(output || busy || interrupted || proposalContext) && (
                        <div className="turn-assistant">
                          <span className="turn-meta">
                            {renderTurnMeta(
                              null,
                              aiRuns.find(
                                (run) =>
                                  run.id ===
                                  (proposalContext?.sourceRunId ??
                                    turns.find((turn) => turn.id === activeTurnId)?.runId),
                              ),
                            )}
                          </span>
                          {(output || busy) && !(proposalContext && output && !busy) && (
                            <div className="turn-text" aria-live="polite">
                              <MessageResponse>{output}</MessageResponse>
                              {busy && <span className="caret" aria-hidden="true" />}
                            </div>
                          )}
                          {interrupted && !failure && stoppedAt && (
                            <div className="turn-state" role="status">
                              <span className="pill">Incomplete</span>
                              <span className="t-secondary">
                                Stopped at {formatTime(stoppedAt)}. Incomplete responses can’t be
                                applied.
                              </span>
                              {submittedPrompt && (
                                <button
                                  type="button"
                                  className="btn-link"
                                  onClick={() => void submitAction(submittedPrompt)}
                                >
                                  Try again
                                </button>
                              )}
                            </div>
                          )}
                          {interrupted && !failure && !stoppedAt && (
                            <div className="turn-state" role="status">
                              <span className="pill">Incomplete</span>
                              <span className="t-secondary">
                                Incomplete responses can’t be applied.
                              </span>
                            </div>
                          )}
                          {failure && (
                            <div className="turn-failure" role="alert">
                              <CircleX aria-hidden="true" />
                              <div>
                                <span style={{ fontSize: 13, lineHeight: '20px' }}>{failure}</span>
                                <div className="links">
                                  {submittedPrompt && (
                                    <button
                                      type="button"
                                      className="btn-link"
                                      onClick={() => void submitAction(submittedPrompt)}
                                    >
                                      Try again
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="btn-link"
                                    onClick={() => setDestination('settings')}
                                  >
                                    AI settings…
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                          {!busy &&
                            !proposalContext &&
                            activeReviewGrounding?.grounding.status === 'review_required' && (
                              <ReviewBlock
                                assessment={activeReviewGrounding.grounding}
                                citations={citations}
                                onOpenCitation={(citation) => void openCitation(citation)}
                              />
                            )}
                          {!busy && !proposalContext && citations.length > 0 && (
                            <div className="citation-list">
                              {citations.map((citation, index) => (
                                <button
                                  key={citation.id}
                                  type="button"
                                  onClick={() => void openCitation(citation)}
                                >
                                  <b>{index + 1}</b> {citation.sourceName} · {citation.locator}
                                </button>
                              ))}
                            </div>
                          )}
                          {renderProposalCard()}
                          {!busy &&
                            !proposalContext &&
                            activeTurnId &&
                            turns.find((turn) => turn.id === activeTurnId)?.runId ===
                              latestReview?.id &&
                            findings.length > 0 && (
                              <div className="patch-list" style={{ marginTop: 8 }}>
                                {findings.map(renderFindingCard)}
                              </div>
                            )}
                        </div>
                      )}
                      {acceptedInfo &&
                        undoRevision !== null &&
                        currentPrd.revision === undoRevision + 1 && (
                          <AcceptedRow
                            section={acceptedInfo.section}
                            revision={acceptedInfo.revision}
                            undoDisabled={dirty || documentMutationBusy}
                            onUndo={() =>
                              void undoAccepted().catch((reason: unknown) =>
                                setError(messageFrom(reason)),
                              )
                            }
                          />
                        )}
                      {rejectedSection && !proposalContext && (
                        <div className="card-row" role="status">
                          <span>Rejected · {rejectedSection} unchanged</span>
                        </div>
                      )}
                      {pendingHandoffs.map(renderHandoffCard)}
                    </div>
                  </div>
                  <div className="composer-dock">
                    <Composer
                      {...composerProps}
                      placeholder={placeholder}
                      textareaRef={composerRef}
                    />
                    {draftRestored && (
                      <span className="t-secondary composer-caption">Draft restored</span>
                    )}
                  </div>
                </>
              )}
            </main>
          )}
          {/* The document stays mounted so editor undo history survives visiting other destinations. */}
          <main
            id="prd-editor"
            className="document"
            tabIndex={-1}
            aria-label="Document"
            hidden={destination !== 'document'}
          >
            <DocumentView
              project={project}
              prd={currentPrd}
              structureName={activeStructureName}
              selectedSectionId={selectedSectionId}
              flashSectionId={flashSectionId}
              disabled={editingDisabled}
              onSelectSection={setSelectedSectionId}
              onSelectionChange={setSelection}
              onTitleChange={(id, title) => {
                if (documentMutationRef.current || recoveryUnavailable || recoveryConflict) return;
                setPrd((current) =>
                  current
                    ? {
                        ...current,
                        sections: current.sections.map((item) =>
                          item.id === id ? { ...item, title } : item,
                        ),
                      }
                    : current,
                );
              }}
              onBodyChange={(id, body) => {
                if (documentMutationRef.current || recoveryUnavailable || recoveryConflict) return;
                setPrd((current) =>
                  current
                    ? {
                        ...current,
                        sections: current.sections.map((item) =>
                          item.id === id ? { ...item, body } : item,
                        ),
                      }
                    : current,
                );
              }}
              onMoveSection={(index, to) => {
                if (!documentMutationRef.current) setPrd(reorder(currentPrd, index, to));
              }}
              onRemoveSection={(id) => setAlert({ kind: 'remove-section', sectionId: id })}
              onAddSection={() => {
                if (documentMutationRef.current || recoveryUnavailable || recoveryConflict) return;
                setPrd({
                  ...currentPrd,
                  sections: [
                    ...currentPrd.sections,
                    {
                      id: crypto.randomUUID(),
                      projectId: project.id,
                      title: 'New section',
                      body: '',
                      position: currentPrd.sections.length,
                      updatedAt: new Date().toISOString(),
                    },
                  ],
                });
              }}
              onEditorReady={registerEditor}
            />
          </main>
          {destination === 'sources' && (
            <main id="destination-sources" tabIndex={-1} aria-label="Sources">
              <SourcesView
                sources={sources}
                notAdded={notAdded}
                selectedId={selectedSourceId}
                evidence={evidenceDetail}
                uploading={uploading}
                busy={busy || documentMutationBusy}
                reduceMotion={reduceMotion}
                onSelect={(id) => {
                  setSelectedSourceId(id);
                  setEvidenceDetail(null);
                }}
                onAddFiles={() => fileInputRef.current?.click()}
                onRetry={(source) => {
                  void api
                    .retrySourceIndex(project.id, source.id)
                    .then((updated) =>
                      setSources((current) =>
                        current.map((item) => (item.id === updated.id ? updated : item)),
                      ),
                    )
                    .catch((reason: unknown) => setError(messageFrom(reason)));
                }}
                onRemove={(source) => setAlert({ kind: 'remove-source', source })}
                onDismiss={(id) =>
                  setNotAdded((current) => current.filter((item) => item.id !== id))
                }
                onDismissAll={() => setNotAdded([])}
                onClearEvidence={() => setEvidenceDetail(null)}
              />
            </main>
          )}
          {destination === 'history' && (
            <main id="destination-history" tabIndex={-1} aria-label="History">
              <HistoryView
                tab={historyTab}
                revisions={revisions}
                aiRuns={aiRuns}
                handoffs={handoffs}
                prd={currentPrd}
                selectedRevision={selectedRevision}
                selectedRunId={selectedRunId}
                busy={busy || documentMutationBusy || dirty}
                onSelectRevision={setSelectedRevision}
                onSelectRun={setSelectedRunId}
                onRestore={(revision) => setAlert({ kind: 'restore', revision })}
                onInspectRun={inspectRun}
                onDismissHandoff={(handoff) => {
                  void api
                    .dismissChatGptHandoff(project.id, handoff.id)
                    .then(() =>
                      setHandoffs((current) => current.filter((item) => item.id !== handoff.id)),
                    )
                    .catch((reason: unknown) => setError(messageFrom(reason)));
                }}
              />
            </main>
          )}
          {destination === 'settings' && (
            <main id="destination-settings" tabIndex={-1} aria-label="AI settings">
              <h1 className="visually-hidden">AI settings</h1>
              <SettingsView
                key={project.id}
                project={project}
                offline={offline}
                disabled={documentMutationBusy}
                initialProvider={project.selectedProvider}
                onProjectChange={onProjectChange}
                onStatesChange={onStatesChange}
              />
            </main>
          )}
          {destination === 'structures' && (
            <main id="destination-structures" tabIndex={-1} aria-label="Structures">
              <StructuresView
                builtIn={builtIn}
                structures={structures}
                selectedId={structureSelection}
                activeStructureId={project.selectedStructureId ?? null}
                busy={documentMutationBusy}
                onSelect={setStructureSelection}
                onUpdate={updateStructure}
                onDuplicate={(entry) => {
                  void api
                    .createStructure(project.id, {
                      name: `${entry.name} copy`,
                      sections: entry.sections,
                    })
                    .then((created) => {
                      setStructures((current) => [...current, created]);
                      setStructureSelection(created.id);
                    })
                    .catch((reason: unknown) => setError(messageFrom(reason)));
                }}
                onDelete={(structure) => setAlert({ kind: 'delete-structure', structure })}
              />
            </main>
          )}
          {showInspector && destination === 'conversation' && (
            <aside
              className={`inspector ${inspectorOverlay ? 'overlay' : ''}`}
              aria-label="PRD inspector"
            >
              <div className="inspector-head">
                <strong>PRD</strong>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setDestination('document')}
                >
                  Open Document <kbd style={{ font: 'inherit' }}>⌘2</kbd>
                </button>
              </div>
              <span className="t-secondary inspector-meta">
                Version {currentPrd.revision} · {emptySections.length}{' '}
                {emptySections.length === 1 ? 'section' : 'sections'} empty
              </span>
              <ul className="inspector-outline" aria-label="Outline">
                {currentPrd.sections.map((section, index) => {
                  const empty = !section.body.trim();
                  const pending = Boolean(
                    proposalContext &&
                    !proposalStale &&
                    output &&
                    proposalContext.targetSectionId === section.id,
                  );
                  return (
                    <li key={section.id}>
                      <a
                        href={`#section-${section.id}`}
                        data-pending={pending}
                        title={section.title}
                        onClick={(event) => {
                          event.preventDefault();
                          setSelectedSectionId(section.id);
                          setDestination('document');
                        }}
                      >
                        <span className="num">{sectionNumber(index)}</span>
                        <span className="name truncate">{section.title}</span>
                        {pending ? (
                          <span className="tag accent">Change pending</span>
                        ) : empty && section.required ? (
                          <span className="tag warning">Required</span>
                        ) : empty ? (
                          <span className="tag">Empty</span>
                        ) : null}
                      </a>
                    </li>
                  );
                })}
              </ul>
              {citations.length > 0 && (
                <div className="inspector-cited">
                  <span className="t-label">Sources cited in this reply</span>
                  {citations.map((citation, index) => (
                    <button
                      key={citation.id}
                      type="button"
                      onClick={() => void openCitation(citation)}
                    >
                      <b>{index + 1}</b> {citation.sourceName} · {citation.locator}
                    </button>
                  ))}
                </div>
              )}
            </aside>
          )}
          {showInspector && destination === 'document' && (
            <aside
              className={`inspector ${inspectorOverlay ? 'overlay' : ''}`}
              aria-label="Assistant"
            >
              <div className="inspector-head">
                <strong>Assistant</strong>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setDestination('conversation')}
                >
                  Open conversation <kbd style={{ font: 'inherit' }}>⌘1</kbd>
                </button>
              </div>
              <div className="inspector-body">
                <span className="t-label">Latest</span>
                {acceptedInfo &&
                undoRevision !== null &&
                currentPrd.revision === undoRevision + 1 ? (
                  <div className="inspector-latest">
                    <CircleCheck aria-hidden="true" style={{ color: 'var(--success)' }} />
                    <div>
                      <span>Accepted change to {acceptedInfo.section}</span>
                      <span className="t-secondary">Version {acceptedInfo.revision}</span>
                    </div>
                    <button
                      type="button"
                      className="btn-link"
                      disabled={dirty || documentMutationBusy}
                      onClick={() =>
                        void undoAccepted().catch((reason: unknown) =>
                          setError(messageFrom(reason)),
                        )
                      }
                    >
                      Undo
                    </button>
                  </div>
                ) : proposalContext && output ? (
                  <div className="inspector-latest">
                    <div>
                      <span>Proposed change to {proposalSectionTitle}</span>
                      <span className="t-secondary">Waiting for your review in Conversation</span>
                    </div>
                  </div>
                ) : turns.length > 0 ? (
                  <div className="inspector-latest">
                    <div>
                      <span className="truncate">
                        {truncateText(turns[turns.length - 1]!.request, 80)}
                      </span>
                      <span className="t-secondary">
                        {truncateText(turns[turns.length - 1]!.response, 120) || 'No reply saved'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <span className="t-secondary">No replies yet.</span>
                )}
              </div>
              <div className="inspector-composer">
                <Composer
                  {...composerProps}
                  compact
                  placeholder={selection.trim() ? 'Ask about the selection' : placeholder}
                />
              </div>
            </aside>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        hidden
        multiple
        aria-label="Add source file"
        accept=".pdf,.docx,.pptx,.xlsx,.jpg,.jpeg,.md,.markdown,.txt"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          void uploadFiles(files);
          event.target.value = '';
        }}
      />
      <input
        ref={archiveInputRef}
        className="visually-hidden"
        type="file"
        hidden
        accept=".prdgenie.zip,.prdgenie,.md,.markdown,.txt,.docx"
        aria-label="Import PRD or restore project archive"
        disabled={documentMutationBusy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && !documentMutationRef.current) {
            void leaveWorkspace(() => onProjectImport(file), 'Saved before opening another PRD');
          }
          event.target.value = '';
        }}
      />

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent
          className="sheet"
          showCloseButton={false}
          aria-label="Export"
          onCloseAutoFocus={(event) => {
            // WebKit drops focus to the body when a dialog closes; return it to the toolbar button.
            event.preventDefault();
            exportButtonRef.current?.focus();
          }}
        >
          <div className="sheet-title">
            <DialogTitle asChild>
              <h2>Export</h2>
            </DialogTitle>
            <DialogDescription asChild>
              <p>
                From the latest edits · Version {currentPrd.revision}
                {dirty
                  ? ', unsaved edits are saved first'
                  : revisions.length
                    ? `, saved at ${formatTime([...revisions].sort((a, b) => b.revision - a.revision)[0]!.createdAt)}`
                    : ''}
              </p>
            </DialogDescription>
          </div>
          <div className="radio-list" role="radiogroup" aria-label="Format">
            {(
              [
                [
                  'markdown',
                  'Markdown (.md)',
                  'Headings and lists as plain text, for repositories and wikis',
                ],
                ['docx', 'Word (.docx)', 'Editable in Word and Pages'],
                ['pdf', 'PDF', 'Fixed layout for reading and review'],
                [
                  'archive',
                  'Project archive (.prdgenie)',
                  'PRD, sources, structure and history. Restore it with Import.',
                ],
              ] as const
            ).map(([value, title, description]) => (
              <label key={value} className="radio-option check">
                <input
                  type="radio"
                  name="export-format"
                  value={value}
                  checked={exportFormat === value}
                  onChange={() => setExportFormat(value)}
                />
                <div>
                  <span className="title">{title}</span>
                  <span className="t-secondary">{description}</span>
                </div>
              </label>
            ))}
          </div>
          {exportStatus && (
            <p className="t-secondary" role="status">
              {exportStatus}
            </p>
          )}
          <div className="sheet-foot">
            <span className="t-secondary">Works offline. You choose where to save next.</span>
            <button type="button" className="btn" onClick={() => setExportOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={documentMutationBusy || saveBusy}
              onClick={() => void exportCurrent(exportFormat)}
            >
              Export…
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <HandoffSheet
        open={handoffOpen}
        onOpenChange={setHandoffOpen}
        prd={currentPrd}
        instruction={handoffInstruction}
        onInstructionChange={(value) => {
          if (!documentMutationRef.current) setHandoffInstruction(value);
        }}
        citations={citations}
        selectedCitationIds={handoffCitationIds}
        onToggleCitation={(id, checked) => {
          if (documentMutationRef.current) return;
          setHandoffCitationIds((current) =>
            checked ? [...current, id] : current.filter((item) => item !== id),
          );
        }}
        disabled={documentMutationBusy || recoveryUnavailable}
        dirty={dirty}
        onPrepare={prepareHandoff}
        onImportResponse={importHandoffResponse}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sheet" showCloseButton={false} aria-label="New project">
          <form
            className="sheet-step"
            style={{ gap: 16 }}
            onSubmit={(event) => {
              event.preventDefault();
              if (!newProjectName.trim()) return;
              void leaveWorkspace(
                () => onProjectCreate(newProjectName.trim()),
                'Saved before creating project',
              ).then(() => setCreateOpen(false));
            }}
          >
            <div className="sheet-title">
              <DialogTitle asChild>
                <h2>New project</h2>
              </DialogTitle>
              <DialogDescription asChild>
                <p>A PRD with the default 13-section structure. Everything stays on this Mac.</p>
              </DialogDescription>
            </div>
            <div className="form-group">
              <label htmlFor="new-project-name">Project name</label>
              <input
                id="new-project-name"
                className="field"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="sheet-foot end">
              <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!newProjectName.trim() || busy || documentMutationBusy}
              >
                Create project
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sheet" showCloseButton={false} aria-label="Rename project">
          <form
            className="sheet-step"
            style={{ gap: 16 }}
            onSubmit={(event) => {
              event.preventDefault();
              if (!renameValue.trim()) return;
              void api
                .updateProject(project.id, { name: renameValue.trim() })
                .then((updated) => {
                  onProjectChange(updated);
                  setRenameOpen(false);
                })
                .catch((reason: unknown) => setError(messageFrom(reason)));
            }}
          >
            <div className="sheet-title">
              <DialogTitle asChild>
                <h2>Rename project</h2>
              </DialogTitle>
            </div>
            <div className="form-group">
              <label htmlFor="rename-project">Name</label>
              <input
                id="rename-project"
                className="field"
                value={renameValue}
                maxLength={120}
                autoFocus
                onChange={(event) => setRenameValue(event.target.value)}
              />
            </div>
            <div className="sheet-foot end">
              <button type="button" className="btn" onClick={() => setRenameOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!renameValue.trim()}>
                Rename
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}>
        <DialogContent className="sheet wide" showCloseButton={false} aria-label="Recovered edits">
          <div className="sheet-title">
            <DialogTitle asChild>
              <h2>Recovered edits</h2>
            </DialogTitle>
            <DialogDescription asChild>
              <p>
                These edits were made on Version {recoveryConflict?.baseRevision}. The saved
                document is Version {currentPrd.revision}. Nothing changes until you choose.
              </p>
            </DialogDescription>
          </div>
          <div className="recovery-document">
            {recoveryConflict?.sections.map((section) => (
              <section key={section.id}>
                <h3>{section.title}</h3>
                <pre>{section.body || '(empty)'}</pre>
              </section>
            ))}
          </div>
          <div className="sheet-foot end">
            <button type="button" className="btn" onClick={() => setRecoveryOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setAlert({ kind: 'discard-recovery' })}
            >
              Keep Version {currentPrd.revision}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || documentMutationBusy}
              onClick={() => {
                if (!recoveryConflict) return;
                setPrd({ ...currentPrd, sections: recoveryConflict.sections });
                setRecoveryConflict(null);
                setRecoveryOpen(false);
                setDestination('document');
              }}
            >
              Save edits as Version {currentPrd.revision + 1}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={alert !== null} onOpenChange={(open) => !open && setAlert(null)}>
        <DialogContent className="alert" role="alertdialog" showCloseButton={false}>
          {alert && <AlertBody alert={alert} />}
        </DialogContent>
      </Dialog>
    </div>
  );

  function AlertBody({ alert }: { alert: AlertKind }) {
    const close = () => setAlert(null);
    switch (alert.kind) {
      case 'delete-project':
        return (
          <>
            <DialogTitle asChild>
              <h2>Delete “{project.name}”?</h2>
            </DialogTitle>
            <DialogDescription asChild>
              <p>
                The PRD, its sources and history are removed from this Mac. Export an archive first
                if you might need it.
                {dirty ? ' This also discards unsaved changes.' : ''}
              </p>
            </DialogDescription>
            <div className="alert-actions">
              <button type="button" className="btn" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={documentMutationBusy}
                onClick={() => {
                  close();
                  void runDocumentMutation(() => onProjectDelete(project.id)).catch(
                    (reason: unknown) => setError(messageFrom(reason)),
                  );
                }}
              >
                Delete
              </button>
            </div>
          </>
        );
      case 'remove-source':
        return (
          <>
            <DialogTitle asChild>
              <h2>Remove “{alert.source.name}” from this project?</h2>
            </DialogTitle>
            <DialogDescription asChild>
              <p>
                Its text leaves the assistant’s evidence. Replies that cited it keep their excerpts
                in History.
              </p>
            </DialogDescription>
            <div className="alert-actions">
              <button type="button" className="btn" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  close();
                  void removeSource(alert.source);
                }}
              >
                Remove
              </button>
            </div>
          </>
        );
      case 'remove-section': {
        const section = currentPrd.sections.find((item) => item.id === alert.sectionId);
        return (
          <>
            <DialogTitle asChild>
              <h2>Remove “{section?.title ?? 'section'}”?</h2>
            </DialogTitle>
            <DialogDescription asChild>
              <p>
                The section and its text leave the document. Earlier versions in History keep it.
              </p>
            </DialogDescription>
            <div className="alert-actions">
              <button type="button" className="btn" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  close();
                  if (documentMutationRef.current || recoveryUnavailable || recoveryConflict)
                    return;
                  setPrd({
                    ...currentPrd,
                    sections: currentPrd.sections
                      .filter((item) => item.id !== alert.sectionId)
                      .map((item, position) => ({ ...item, position })),
                  });
                }}
              >
                Remove
              </button>
            </div>
          </>
        );
      }
      case 'restore':
        return (
          <>
            <DialogTitle asChild>
              <h2>Restore Version {alert.revision.revision}?</h2>
            </DialogTitle>
            <DialogDescription asChild>
              <p>This creates Version {currentPrd.revision + 1}. No revision is deleted.</p>
            </DialogDescription>
            <div className="alert-actions">
              <button type="button" className="btn" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  close();
                  void runDocumentMutation(async () => {
                    const restored = await api.restoreRevision(
                      project.id,
                      alert.revision.revision,
                      currentPrd.revision,
                    );
                    setPrd(restored);
                    setSavedPrd(restored);
                    setUndoRevision(null);
                    setAcceptedInfo(null);
                    setRevisions((await api.revisions(project.id)).revisions);
                    setSelectedRevision(restored.revision);
                  }).catch((reason: unknown) => setError(messageFrom(reason)));
                }}
              >
                Restore
              </button>
            </div>
          </>
        );
      case 'use-structure':
        return (
          <>
            <DialogTitle asChild>
              <h2>Use “{alert.entry.name}” for this project?</h2>
            </DialogTitle>
            <DialogDescription asChild>
              <p>
                Section headings change to match. Text in sections with the same title is kept; the
                change is saved as a new version.
              </p>
            </DialogDescription>
            <div className="alert-actions">
              <button type="button" className="btn" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  close();
                  applyStructure(alert.entry);
                }}
              >
                Use
              </button>
            </div>
          </>
        );
      case 'delete-structure':
        return (
          <>
            <DialogTitle asChild>
              <h2>Delete “{alert.structure.name}”?</h2>
            </DialogTitle>
            <DialogDescription asChild>
              <p>Documents already using it keep their sections.</p>
            </DialogDescription>
            <div className="alert-actions">
              <button type="button" className="btn" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  close();
                  void api
                    .deleteStructure(project.id, alert.structure.id)
                    .then(() => {
                      setStructures((current) =>
                        current.filter((item) => item.id !== alert.structure.id),
                      );
                      setStructureSelection(BUILT_IN_STRUCTURE_ID);
                    })
                    .catch((reason: unknown) => setError(messageFrom(reason)));
                }}
              >
                Delete
              </button>
            </div>
          </>
        );
      case 'discard-recovery':
        return (
          <>
            <DialogTitle asChild>
              <h2>Keep Version {currentPrd.revision}?</h2>
            </DialogTitle>
            <DialogDescription asChild>
              <p>The recovered edits are discarded. Every saved revision stays in History.</p>
            </DialogDescription>
            <div className="alert-actions">
              <button type="button" className="btn" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  close();
                  setRecoveryConflict(null);
                  setRecoveryOpen(false);
                }}
              >
                Keep Version {currentPrd.revision}
              </button>
            </div>
          </>
        );
    }
  }

  function inspectRun(run: AiRunProposal) {
    if (documentMutationRef.current || busy) return;
    setInterrupted(run.status !== 'completed');
    setFailure('');
    setStoppedAt('');
    if (run.scope !== 'selection') setScope(run.scope, run.targetSectionId);
    setOutput(
      proposalDraft?.runId === run.id && proposalDraft.text
        ? proposalDraft.text
        : (run.outputText ?? ''),
    );
    // Reopening a rejected proposal clears the recorded rejection.
    setProposalDraft((draft) => (draft?.runId === run.id && !draft.text ? undefined : draft));
    setCitations(run.citations);
    setActiveReviewGrounding(
      run.action === 'review' && run.grounding
        ? { runId: run.id, sourceRevision: run.sourceRevision, grounding: run.grounding }
        : null,
    );
    setHandoffCitationIds([]);
    setProposalContext(contextForRun(run, currentPrd.revision, turns));
    setActiveTurnId(turns.find((turn) => turn.runId === run.id)?.id ?? null);
    setSubmittedPrompt('');
    setAcceptedInfo(null);
    setRejectedSection(null);
    setDestination('conversation');
  }
}

function reorder(prd: PrdDocument, from: number, to: number): PrdDocument {
  if (to < 0 || to >= prd.sections.length) return prd;
  const sections = [...prd.sections];
  const [moved] = sections.splice(from, 1);
  if (!moved) return prd;
  sections.splice(to, 0, moved);
  return { ...prd, sections: sections.map((section, position) => ({ ...section, position })) };
}

function contextForRun(
  run: AiRunProposal,
  revision: number,
  turns: WorkspaceTurn[],
): ProposalContext | null {
  if (run.action !== 'draft' && run.action !== 'rewrite') return null;
  return {
    sourceRunId: run.id,
    runId:
      run.status === 'completed' &&
      run.appliedRevision === null &&
      run.sourceRevision === revision &&
      run.citations.every((citation) => citation.available)
        ? run.id
        : null,
    sourceRevision: run.sourceRevision,
    action: run.action,
    scope: run.scope,
    provider: run.provider,
    model: run.model,
    appliedRevision: run.appliedRevision,
    targetSectionId: run.targetSectionId,
    selectionText: run.selectionText,
    instruction: turns.find((turn) => turn.runId === run.id)?.request ?? null,
    grounding: run.grounding ?? null,
  };
}
