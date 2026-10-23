import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  PanelLeft,
  MessageSquare,
  Paperclip,
  Settings2,
  FileText,
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
  ProviderState,
  ReviewFinding,
  RevisionSummary,
  SourceSummary,
  WorkspaceState,
  WorkspaceTurn,
} from '@shared/types';
import { api, ClientApiError, runAction } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { isNative, postShellState, readLocalPrompt } from '@/lib/native-shell';
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
import { StructurePanel } from '@/components/StructurePanel';
import { exampleSource, exampleSourceName, fillExample } from '@/example-project';

type PanelTab = 'assist' | 'review' | 'evidence' | 'history';

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
}

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importWarnings, setImportWarnings] = useState<Record<string, string[]>>({});

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
    if (warnings.length) setImportWarnings((current) => ({ ...current, [project.id]: warnings }));
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
    if (file.name.toLowerCase().endsWith('.prdgenie.zip')) {
      project = (await api.restoreProject(file)).project;
    } else {
      const imported = await api.importProject(file);
      project = imported.project;
      if (imported.warnings.length > 0) {
        setImportWarnings((current) => ({ ...current, [project.id]: imported.warnings }));
      }
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
    return (
      <EmptyWorkspace
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
        importWarnings={importWarnings[project.id] ?? []}
        onDismissImportWarnings={() =>
          setImportWarnings((current) => {
            const next = { ...current };
            delete next[project.id];
            return next;
          })
        }
      />
    </TooltipProvider>
  );
}

function EmptyWorkspace({
  onCreate,
  onImport,
  onExample,
}: {
  onCreate: (name: string, instruction?: string, files?: File[]) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onExample: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const importRef = useRef<HTMLInputElement | null>(null);
  const sourcesRef = useRef<HTMLInputElement | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    postShellState({
      title: 'PRD Genie',
      subtitle: 'Local workspace',
      dirty: false,
      busy,
      recoveryPending: Boolean(instruction || files.length),
      hasProject: false,
    });
    const command = (event: Event) => {
      if ((event as CustomEvent<string>).detail === 'new-project') instructionRef.current?.focus();
    };
    window.addEventListener('prd-command', command);
    return () => window.removeEventListener('prd-command', command);
  }, [busy, instruction, files.length]);
  async function perform(operation: () => Promise<void>) {
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
  }
  return (
    <main className="onboarding" aria-busy={busy}>
      <BookOpenText className="onboarding-mark" aria-hidden="true" />
      <h1>Start with instructions or material.</h1>
      <p className="onboarding-copy">
        Describe a product, review a PRD, or bring a question. Your instructions and material stay
        together in a local project.
      </p>
      <form
        className="create-project"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(() => onCreate(name.trim() || 'Untitled project', instruction, files));
        }}
      >
        <label className="visually-hidden" htmlFor="first-instruction">
          Your instruction
        </label>
        <textarea
          id="first-instruction"
          ref={instructionRef}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="What would you like to work on?"
          maxLength={20000}
          disabled={busy}
        />
        {files.length > 0 && (
          <ul className="pending-sources">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`}>
                <Paperclip aria-hidden="true" />
                <span>{file.name}</span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                >
                  <X aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="start-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => sourcesRef.current?.click()}
          >
            <Paperclip aria-hidden="true" />
            Add material
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Opening…' : 'Open workspace'}
          </Button>
        </div>
        <details>
          <summary>
            Name this project <span className="muted">(optional)</span>
          </summary>
          <label className="visually-hidden" htmlFor="project-name">
            Project name
          </label>
          <input
            id="project-name"
            value={name}
            placeholder="Untitled project"
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        </details>
      </form>
      <p className="sheet-note">
        Nothing is sent to AI until you choose a provider and send an instruction.
      </p>
      <div className="start-alternatives">
        <Button variant="ghost" disabled={busy} onClick={() => importRef.current?.click()}>
          <FilePlus2 aria-hidden="true" />
          Open an existing PRD
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void perform(onExample)}>
          <BookOpenText aria-hidden="true" />
          Explore an example
        </Button>
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
        accept=".md,.markdown,.docx,.txt,.prdgenie.zip"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void perform(() => onImport(file));
          event.target.value = '';
        }}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="disk-note">
        No account required. Editing, history and export work offline. Local files rely on your
        Mac’s disk protection.
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
  importWarnings: string[];
  onDismissImportWarnings: () => void;
}

function Workbench({
  project,
  projects,
  onProjectSelect,
  onProjectCreate,
  onProjectImport,
  onProjectChange,
  onProjectDelete,
  importWarnings,
  onDismissImportWarnings,
}: WorkbenchProps) {
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
  const [tab, setTab] = useState<PanelTab>('assist');
  const [railOpen, setRailOpen] = useState(true);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [structureOpen, setStructureOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [autoAction, setAutoAction] = useState(true);
  const [activitySequence, setActivitySequence] = useState(0);
  const [stalled, setStalled] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [providerOpen, setProviderOpen] = useState(false);
  const [activeProviderState, setActiveProviderState] = useState<ProviderState | null>(null);
  const [action, setAction] = useState<AiAction>('ask');
  const [scope, setScope] = useState<ActionScope>('document');
  const [output, setOutput] = useState('');
  const [prompt, setPrompt] = useState(() => readLocalPrompt(project.id));
  const [interrupted, setInterrupted] = useState(false);
  const [proposalContext, setProposalContext] = useState<ProposalContext | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [documentMutationBusy, setDocumentMutationBusy] = useState(false);
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
  const documentMutationRef = useRef(false);

  useEffect(() => {
    if (providerOpen || !project.selectedProvider) return;
    void api
      .providerStates()
      .then(({ providers }) => {
        setActiveProviderState(
          providers.find((item) => item.provider === project.selectedProvider) ?? null,
        );
      })
      .catch(() => setActiveProviderState(null));
  }, [providerOpen, project.selectedProvider]);

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
          if (workspace.proposal) {
            const run = runResult.runs.find((item) => item.id === workspace.proposal?.runId);
            setOutput(workspace.proposal.text);
            if (run) {
              setCitations(run.citations);
              setProposalContext(contextForRun(run, document.revision));
              setActiveTurnId(workspace.turns.find((turn) => turn.runId === run.id)?.id ?? null);
            }
          }
          if (workspace.revision > 0) setPrompt(workspace.prompt);
          recoveryRevision.current = workspace.revision;
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

  const selectedSection = prd?.sections.find((section) => section.id === selectedSectionId);

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
      if (recoverySnapshot.current)
        recoverySnapshot.current = { ...recoverySnapshot.current, draft: null };
      setUndoRevision(null);
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

  async function exportCurrent(format: 'markdown' | 'docx' | 'pdf' | 'archive') {
    if (documentMutationRef.current || !prd) return;
    if (recoveryConflict) {
      setExportOpen(false);
      setRecoveryOpen(true);
      return;
    }
    setExportStatus('Preparing the latest document…');
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
    setExportStatus(
      isNative
        ? 'Choose where to save the exported file.'
        : 'Export requested. Check your browser downloads.',
    );
  }

  async function submitAction(
    instruction: string,
    override?: { action: AiAction; scope: ActionScope },
  ) {
    if (documentMutationRef.current) return;
    if (recoveryUnavailable) return;
    if (recoveryConflict) {
      setRecoveryOpen(true);
      return;
    }
    if (!prd || !project.selectedProvider || !project.selectedModel) {
      setProviderOpen(true);
      return;
    }
    if (busy) return false;
    if (instruction.length > 10000) {
      setError(
        'Keep the instruction under 10,000 characters. Add longer material as a source; your text is retained.',
      );
      return false;
    }
    const requestedAction =
      override?.action ?? (autoAction ? actionForInstruction(instruction, prd) : action);
    const requestedScope = override?.scope ?? scope;
    const requestedTargetSectionId =
      requestedScope === 'document' ? null : selectedSectionId || null;
    const requestedSelectionText = requestedScope === 'selection' ? selection : null;
    if (!requestedTargetSectionId && requestedScope !== 'document') {
      setError('Choose a target section before running this action.');
      return;
    }
    if (requestedScope === 'selection' && !requestedSelectionText?.trim()) {
      setError('Select document text before running a selection action.');
      return;
    }
    if (offline && project.selectedProvider !== 'ollama') {
      setError('This provider requires a network connection. Local Ollama remains available.');
      return;
    }
    const savedBeforeAction = dirty ? await save('Saved before AI action') : prd;
    if (!savedBeforeAction) return;
    const current = savedBeforeAction;
    setBusy(true);
    setSubmittedPrompt(instruction.trim());
    const turnId = crypto.randomUUID();
    setActiveTurnId(turnId);
    setTurns((items) => [
      ...items,
      { id: turnId, request: instruction.trim(), response: '', runId: null, status: 'interrupted' },
    ]);
    setActivitySequence((sequence) => sequence + 1);
    setStalled(false);
    setDocumentOpen(false);
    setTab('assist');
    setError('');
    setOutput('');
    setInterrupted(false);
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
            setStatus(next.detail);
          },
          onCompletion: (completion) => {
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
              });
            }
            void api.aiRuns(project.id).then((result) => setAiRuns(result.runs));
          },
        },
        controller.signal,
      );
      if (requestedAction === 'review') setTab('review');
      return true;
    } catch (reasonCaught) {
      setInterrupted(true);
      if (!(reasonCaught instanceof DOMException && reasonCaught.name === 'AbortError')) {
        setError(messageFrom(reasonCaught));
      }
      return false;
    } finally {
      setBusy(false);
      setStalled(false);
      setStatus('');
      abortRef.current = null;
    }
  }

  async function applyOutput() {
    if (
      !prd ||
      !proposalContext?.runId ||
      (proposalContext.action !== 'draft' && proposalContext.action !== 'rewrite') ||
      proposalContext.sourceRevision !== prd.revision ||
      !output.trim() ||
      citations.some((citation) => !citation.available) ||
      dirty ||
      documentMutationRef.current
    )
      return;
    const { runId, sourceRevision } = proposalContext;
    const saved = await runDocumentMutation(() =>
      api.applyAiRun(project.id, runId, sourceRevision, output.trim()),
    );
    if (!saved) return;
    setUndoRevision(sourceRevision);
    setPrd(saved);
    setSavedPrd(saved);
    setOutput('');
    setProposalDraft((draft) => (draft?.runId === runId ? undefined : draft));
    setProposalContext(null);
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
    setRevisions((await api.revisions(project.id)).revisions);
  }

  async function upload(file: File) {
    const source = await api.addSource(project.id, file);
    setSources((current) => [...current, source]);
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
    setDocumentOpen(false);
    setTab('evidence');
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
    if (
      !prd ||
      !selectedSectionId ||
      !handoffInstruction.trim() ||
      dirty ||
      documentMutationRef.current
    )
      return;
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
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function importChatGptHandoff(file: File) {
    if (documentMutationRef.current) return;
    const handoff = await api.importChatGptHandoff(project.id, file);
    setHandoffs((current) => [handoff, ...current.filter((item) => item.id !== handoff.id)]);
    setTab('history');
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
      setError('Select at least one ChatGPT patch before applying the handoff.');
      return;
    }
    const restoredRevision = prd.revision;
    const saved = await runDocumentMutation(() =>
      api.applyChatGptHandoff(project.id, handoff.id, prd.revision, patches),
    );
    if (!saved) return;
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
            : `Recovery could not be saved locally. Keep this window open. ${messageFrom(reason)}`,
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
    }, 350);
    return () => window.clearTimeout(timer);
  }, [workspaceSnapshot, persistRecovery]);

  useEffect(() => {
    if (!busy) return;
    const started = performance.now();
    const timer = window.setInterval(() => setStalled(performance.now() - started > 45000), 1000);
    return () => window.clearInterval(timer);
  }, [busy, activitySequence]);

  useEffect(() => {
    postShellState({
      title: project.name,
      subtitle: saveBusy
        ? 'Saving…'
        : dirty
          ? 'Unsaved edits'
          : `Saved locally · Version ${prd?.revision ?? 0}`,
      dirty,
      busy: busy || navigationBusy,
      recoveryPending,
      modalOpen:
        providerOpen || sourcesOpen || structureOpen || exportOpen || createOpen || recoveryOpen,
      hasProject: true,
    });
  }, [
    project.name,
    saveBusy,
    dirty,
    busy,
    navigationBusy,
    recoveryPending,
    prd?.revision,
    providerOpen,
    sourcesOpen,
    structureOpen,
    exportOpen,
    createOpen,
    recoveryOpen,
  ]);

  useEffect(() => {
    const command = (event: Event) => {
      switch ((event as CustomEvent<string>).detail) {
        case 'toggle-sidebar':
          setRailOpen((open) => !open);
          break;
        case 'conversation':
          setDocumentOpen(false);
          setTab('assist');
          break;
        case 'document':
          setDocumentOpen((open) => !open);
          break;
        case 'sources':
          setSourcesOpen(true);
          break;
        case 'history':
          setDocumentOpen(false);
          setTab('history');
          break;
        case 'export':
          setExportOpen(true);
          break;
        case 'settings':
          setProviderOpen(true);
          break;
        case 'save':
          if (dirty) void save();
          break;
        case 'new-project':
          setCreateOpen(true);
          break;
      }
    };
    const download = (event: Event) => {
      const result = (event as CustomEvent<{ status: string; message?: string }>).detail;
      setExportStatus(
        result.status === 'completed'
          ? 'Export saved.'
          : result.status === 'cancelled'
            ? 'Export cancelled. Your document is unchanged.'
            : result.message || 'Export could not finish. Try another location.',
      );
    };
    const keyboard = (event: KeyboardEvent) => {
      if (!isNative && (event.metaKey || event.ctrlKey)) {
        if (event.key === 's') {
          event.preventDefault();
          if (dirty) void save();
        }
        if (event.key === ',') {
          event.preventDefault();
          setProviderOpen(true);
        }
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

  useEffect(() => {
    document
      .getElementById(documentOpen ? 'prd-editor' : 'conversation-workspace')
      ?.focus({ preventScroll: true });
  }, [documentOpen, tab]);

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setSourcesOpen(true);
    setUploading(true);
    const failures: string[] = [];
    setError('');
    try {
      for (const file of files) {
        try {
          await upload(file);
        } catch (reason) {
          failures.push(`${file.name}: ${messageFrom(reason)}`);
        }
      }
      if (failures.length) setError(failures.join(' '));
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

  async function importAnotherProject(file: File) {
    await leaveWorkspace(() => onProjectImport(file), 'Saved before opening another PRD');
  }

  async function createAnotherProject() {
    if (!newProjectName.trim()) return;
    await leaveWorkspace(
      () => onProjectCreate(newProjectName.trim()),
      'Saved before creating project',
    );
  }

  if (!prd || !workspaceLoaded) {
    return (
      <main className="boot-state" aria-busy={!error}>
        <BookOpenText aria-hidden="true" />
        <p>{error || 'Opening project…'}</p>
        {error && <Button onClick={() => window.location.reload()}>Retry</Button>}
      </main>
    );
  }

  const proposalTargetSection = proposalContext?.targetSectionId
    ? prd.sections.find((section) => section.id === proposalContext.targetSectionId)
    : undefined;
  const proposalTargetLabel =
    proposalContext?.scope === 'document'
      ? 'Complete document'
      : proposalTargetSection
        ? proposalTargetSection.title
        : proposalContext?.targetSectionId
          ? 'Archived section'
          : 'Unknown target';
  const proposalApplyLabel =
    proposalContext?.scope === 'document'
      ? 'Apply to document'
      : proposalContext?.scope === 'selection'
        ? `Apply to selection in ${proposalTargetSection?.title ?? 'section'}`
        : `Apply to ${proposalTargetSection?.title ?? 'section'}`;

  return (
    <div
      inert={navigationBusy}
      aria-busy={navigationBusy}
      className={`workbench ${railOpen ? 'rail-visible' : 'rail-hidden'} ${isNative ? 'native-workbench' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          setSourcesOpen(true);
          void uploadFiles(Array.from(event.dataTransfer.files));
        }
      }}
    >
      <a className="skip-link" href={documentOpen ? '#prd-editor' : '#conversation-workspace'}>
        Skip to workspace
      </a>
      <header className={`topbar ${isNative ? 'native-hidden' : ''}`}>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle project navigation"
          aria-expanded={railOpen}
          onClick={() => setRailOpen(!railOpen)}
        >
          <PanelLeft aria-hidden="true" />
        </Button>
        <div className="project-title">
          <strong>{project.name}</strong>
          <small>
            {saveBusy
              ? 'Saving…'
              : dirty
                ? 'Unsaved edits'
                : `Saved locally · Version ${prd.revision}`}
          </small>
        </div>
        <div className="topbar-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sources"
            onClick={() => setSourcesOpen(true)}
          >
            <Paperclip aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="History"
            onClick={() => {
              setDocumentOpen(false);
              setTab('history');
            }}
          >
            <History aria-hidden="true" />
          </Button>
          <Button variant="outline" onClick={() => setExportOpen(true)}>
            Export
          </Button>
        </div>
      </header>
      <div className="workspace-notices">
        {offline && (
          <div className="offline-banner" role="status">
            You are offline. Editing, saving and export remain available. AI works offline only with
            a running local model.
          </div>
        )}

        {importWarnings.length > 0 && (
          <div className="inline-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>Import needs a visual check: {importWarnings.join(' ')}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss import warning"
              onClick={onDismissImportWarnings}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        )}
        {undoRevision !== null && prd.revision === undoRevision + 1 && (
          <div className="undo-banner" role="status">
            <span>A proposal changed the current revision.</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={dirty || documentMutationBusy}
              onClick={() => void undoAccepted()}
            >
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
        {storageError && (
          <div role="alert" className="inline-error">
            <span>{storageError}</span>
            {!recoveryUnavailable && (
              <Button variant="ghost" onClick={() => void persistRecovery()}>
                Retry
              </Button>
            )}
          </div>
        )}
        {recoveryStatus && (
          <div className="undo-banner" role="status">
            <span>{recoveryStatus}</span>
            <Button
              variant="ghost"
              onClick={() => {
                setDocumentOpen(true);
                setRecoveryStatus('');
              }}
            >
              Review document
            </Button>
          </div>
        )}
        {recoveryConflict && (
          <div className="inline-error" role="alert">
            <span>
              Recovered edits were based on an older document version. Choose what to keep before
              editing.
            </span>
            <Button variant="ghost" onClick={() => setRecoveryOpen(true)}>
              Review recovered edits
            </Button>
          </div>
        )}
      </div>

      <aside
        className={`left-rail ${railOpen ? 'drawer-open' : ''}`}
        hidden={!railOpen}
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
              disabled={documentMutationBusy}
              onClick={() => setCreateOpen(true)}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
          {projects.map((item) => (
            <button
              key={item.id}
              className={item.id === project.id ? 'rail-item selected' : 'rail-item'}
              disabled={documentMutationBusy}
              onClick={() => {
                if (item.id !== project.id)
                  void leaveWorkspace(
                    () => onProjectSelect(item.id),
                    'Saved before switching projects',
                  );
              }}
            >
              <FolderOpen aria-hidden="true" />
              <span>{item.name}</span>
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={documentMutationBusy}
            onClick={() => archiveInputRef.current?.click()}
          >
            <Upload aria-hidden="true" />
            Import PRD or archive
          </Button>
          <input
            ref={archiveInputRef}
            className="visually-hidden"
            type="file"
            hidden
            accept=".prdgenie.zip,.md,.markdown,.txt,.docx"
            aria-label="Import PRD or restore project archive"
            disabled={documentMutationBusy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file && !documentMutationRef.current) {
                void importAnotherProject(file).catch((reason: unknown) =>
                  setError(messageFrom(reason)),
                );
              }
              event.target.value = '';
            }}
          />
        </nav>

        <nav className="workspace-navigation" aria-label="Workspace">
          <button
            className={!documentOpen && tab === 'assist' ? 'rail-item selected' : 'rail-item'}
            onClick={() => {
              setDocumentOpen(false);
              setTab('assist');
            }}
          >
            <MessageSquare aria-hidden="true" />
            <span>Conversation</span>
          </button>
          <button
            className={documentOpen ? 'rail-item selected' : 'rail-item'}
            onClick={() => setDocumentOpen(true)}
          >
            <FileText aria-hidden="true" />
            <span>Document</span>
          </button>
          <button className="rail-item" onClick={() => setSourcesOpen(true)}>
            <Paperclip aria-hidden="true" />
            <span>Sources</span>
            <small>{sources.length}</small>
          </button>
          <button
            className={!documentOpen && tab === 'history' ? 'rail-item selected' : 'rail-item'}
            onClick={() => {
              setDocumentOpen(false);
              setTab('history');
            }}
          >
            <History aria-hidden="true" />
            <span>History</span>
          </button>
        </nav>
        <nav className="document-outline" aria-label="Document outline" hidden={!documentOpen}>
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
                setDocumentOpen(true);
              }}
            >
              <span>{String(section.position + 1).padStart(2, '0')}</span>
              {section.title}
            </a>
          ))}
        </nav>

        <section className="project-lifecycle" aria-label="Project data">
          <Button variant="ghost" size="sm" onClick={() => setProviderOpen(true)}>
            <Settings2 aria-hidden="true" />
            AI settings
          </Button>
          <button
            type="button"
            disabled={documentMutationBusy || saveBusy}
            onClick={() => void exportCurrent('archive')}
          >
            <Download aria-hidden="true" />
            Export archive
          </button>
          <Button
            variant="ghost"
            size="sm"
            disabled={documentMutationBusy}
            onClick={() => {
              if (documentMutationRef.current) return;
              if (
                !window.confirm(
                  dirty
                    ? `Delete ${project.name} and discard unsaved changes? Export an archive first if you may need this project later.`
                    : `Delete ${project.name}? Export an archive first if you may need this project later.`,
                )
              )
                return;
              void runDocumentMutation(() => onProjectDelete(project.id)).catch((reason: unknown) =>
                setError(messageFrom(reason)),
              );
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete project
          </Button>
        </section>
      </aside>

      <main id="prd-editor" className="document-surface" hidden={!documentOpen} tabIndex={-1}>
        <div className="workspace-viewbar">
          <Button
            variant="ghost"
            onClick={() => {
              setDocumentOpen(false);
              setTab('assist');
            }}
          >
            <MessageSquare aria-hidden="true" />
            Conversation
          </Button>
          <span>Document</span>
          <Button variant="ghost" onClick={() => setStructureOpen(true)}>
            Structure
          </Button>
          <Button disabled={!dirty || saveBusy || documentMutationBusy} onClick={() => void save()}>
            <Save aria-hidden="true" />
            {saveBusy ? 'Saving…' : 'Save'}
          </Button>
        </div>
        <div className="document-heading">
          <p className="eyebrow">Product requirements document</p>
          <h1>{project.name}</h1>
          <p>
            {project.description || `Version ${prd.revision} · ${prd.sections.length} sections`}
          </p>
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
                  disabled={
                    documentMutationBusy || recoveryUnavailable || Boolean(recoveryConflict)
                  }
                  value={section.title}
                  onFocus={() => setSelectedSectionId(section.id)}
                  onChange={(event) => {
                    if (documentMutationRef.current || recoveryUnavailable || recoveryConflict)
                      return;
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
                    );
                  }}
                />
                <div className="section-controls">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${section.title} up`}
                    disabled={documentMutationBusy || index === 0}
                    onClick={() => {
                      if (!documentMutationRef.current) setPrd(reorder(prd, index, index - 1));
                    }}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${section.title} down`}
                    disabled={documentMutationBusy || index === prd.sections.length - 1}
                    onClick={() => {
                      if (!documentMutationRef.current) setPrd(reorder(prd, index, index + 1));
                    }}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${section.title}`}
                    disabled={
                      documentMutationBusy || Boolean(recoveryConflict) || prd.sections.length === 1
                    }
                    onClick={() => {
                      if (documentMutationRef.current || recoveryUnavailable || recoveryConflict)
                        return;
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
                disabled={documentMutationBusy || recoveryUnavailable || Boolean(recoveryConflict)}
                onFocus={() => setSelectedSectionId(section.id)}
                onSelectionChange={setSelection}
                onChange={(body) => {
                  if (documentMutationRef.current || recoveryUnavailable || recoveryConflict)
                    return;
                  setPrd((current) =>
                    current
                      ? {
                          ...current,
                          sections: current.sections.map((item) =>
                            item.id === section.id ? { ...item, body } : item,
                          ),
                        }
                      : current,
                  );
                }}
              />
            </section>
          ))}
          <Button
            variant="outline"
            className="add-section"
            disabled={documentMutationBusy || recoveryUnavailable || Boolean(recoveryConflict)}
            onClick={() => {
              if (documentMutationRef.current || recoveryUnavailable || recoveryConflict) return;
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
              });
            }}
          >
            <Plus aria-hidden="true" />
            Add section
          </Button>
        </div>
      </main>

      <main
        id="conversation-workspace"
        className="workspace-panel"
        hidden={documentOpen}
        tabIndex={-1}
        aria-label="Conversation and document work"
      >
        <h1 className="visually-hidden">{project.name}</h1>
        <div className="workspace-viewbar">
          <button
            className={tab === 'assist' ? 'view-selected' : ''}
            onClick={() => setTab('assist')}
          >
            Conversation
          </button>
          <button onClick={() => setDocumentOpen(true)}>Document</button>
          <span className="viewbar-spacer" />
          {tab !== 'assist' && (
            <span>
              {tab === 'review' ? 'Review findings' : tab === 'history' ? 'History' : 'Evidence'}
            </span>
          )}
          {findings.filter((finding) => finding.status === 'open').length > 0 &&
            tab !== 'review' && (
              <button onClick={() => setTab('review')}>
                Review findings ({findings.filter((finding) => finding.status === 'open').length})
              </button>
            )}
          <button onClick={() => setStructureOpen(true)}>Structure</button>
        </div>

        {tab === 'assist' && (
          <div className="assist-panel">
            <Conversation className="assist-conversation">
              <ConversationContent>
                {turns
                  .filter((turn) => turn.id !== activeTurnId)
                  .map((turn) => (
                    <div className="conversation-turn" key={turn.id}>
                      <Message from="user">
                        <span className="message-author">You</span>
                        <MessageContent>
                          <p>{turn.request || 'Document action'}</p>
                        </MessageContent>
                      </Message>
                      <Message from="assistant">
                        <span className="message-author">PRD Genie</span>
                        <MessageContent>
                          <MessageResponse>
                            {turn.response ||
                              (turn.status === 'complete'
                                ? 'Review completed. Open findings or History for the result.'
                                : 'This response did not finish.')}
                          </MessageResponse>
                        </MessageContent>
                        {turn.status === 'interrupted' && (
                          <p className="recovery-note">
                            Incomplete response. No changes were applied automatically.
                          </p>
                        )}
                        {turn.runId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setTab('history');
                            }}
                          >
                            Inspect saved run in History
                          </Button>
                        )}
                      </Message>
                    </div>
                  ))}
                {submittedPrompt && (
                  <Message from="user">
                    <span className="message-author">You</span>
                    <MessageContent>
                      <p>{submittedPrompt}</p>
                    </MessageContent>
                  </Message>
                )}

                {!output && !busy && !interrupted && turns.length === 0 ? (
                  <ConversationEmptyState
                    icon={<SearchCheck />}
                    title={
                      prd.sections.some((section) => section.body.trim())
                        ? 'Continue with this PRD'
                        : 'What would you like to work on?'
                    }
                    description="Describe what you need, add supporting material, or ask for a review. Proposed changes are yours to accept."
                  />
                ) : output || busy || interrupted ? (
                  <Message from="assistant">
                    <span className="message-author">PRD Genie</span>
                    <MessageContent>
                      {busy && (
                        <p className="stream-status" role="status">
                          {status || 'Preparing response…'}
                        </p>
                      )}
                      {stalled && busy && (
                        <p className="recovery-note" role="status">
                          Still waiting for the provider. You can stop safely; your instruction will
                          be kept.
                        </p>
                      )}
                      {interrupted && (
                        <p className="inline-error" role="alert">
                          This response stopped before completion. Your request is kept below; run
                          it again when ready.
                        </p>
                      )}
                      <MessageResponse>{output}</MessageResponse>
                      {!busy && output && (
                        <Button variant="ghost" size="sm" onClick={() => setDocumentOpen(true)}>
                          Open document
                        </Button>
                      )}
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
                    {output && proposalContext && (
                      <>
                        <p className="proposal-provenance">
                          Proposed change · Based on version {proposalContext.sourceRevision}
                        </p>
                        <p className="proposal-provenance">
                          Target: {proposalTargetLabel}
                          {proposalContext.selectionText
                            ? `. Selected text: "${truncateText(proposalContext.selectionText)}"`
                            : ''}
                        </p>
                        {citations.some((citation) => !citation.available) && (
                          <p className="proposal-provenance" role="alert">
                            This proposal cannot be applied because its source evidence was deleted.
                          </p>
                        )}
                        {!busy && (
                          <details className="proposal-revision">
                            <summary>Revise proposal before applying</summary>
                            <textarea
                              aria-label="Revised AI proposal"
                              value={output}
                              disabled={documentMutationBusy || recoveryUnavailable}
                              onChange={(event) => {
                                if (!documentMutationRef.current && !recoveryUnavailable) {
                                  if (
                                    proposalDraft &&
                                    proposalDraft.runId !== proposalContext?.sourceRunId &&
                                    !window.confirm(
                                      'Replace your saved edits to the other proposal? Cancel to keep them in History.',
                                    )
                                  )
                                    return;
                                  setOutput(event.target.value);
                                  setProposalDraft({
                                    runId: proposalContext?.sourceRunId ?? null,
                                    text: event.target.value,
                                  });
                                }
                              }}
                            />
                          </details>
                        )}
                        <MessageActions>
                          <MessageAction
                            size="sm"
                            label={proposalApplyLabel}
                            tooltip="Creates a revision bound to this AI run"
                            disabled={
                              !proposalContext.runId ||
                              proposalContext.sourceRevision !== prd.revision ||
                              citations.some((citation) => !citation.available) ||
                              busy ||
                              dirty ||
                              documentMutationBusy
                            }
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
                            size="sm"
                            label="Dismiss proposal"
                            tooltip="Leaves the PRD unchanged"
                            disabled={documentMutationBusy}
                            onClick={() => {
                              if (documentMutationRef.current) return;
                              setOutput('');
                              setProposalDraft((draft) =>
                                draft?.runId === proposalContext?.sourceRunId ? undefined : draft,
                              );
                              setProposalContext(null);
                            }}
                          >
                            <X aria-hidden="true" />
                            Dismiss
                          </MessageAction>
                        </MessageActions>
                      </>
                    )}
                  </Message>
                ) : null}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            <div className="action-context">
              <label>
                <span>Action</span>
                <select
                  value={autoAction ? 'auto' : action}
                  disabled={documentMutationBusy}
                  onChange={(event) => {
                    if (!documentMutationRef.current) {
                      setAutoAction(event.target.value === 'auto');
                      if (event.target.value !== 'auto') setAction(event.target.value as AiAction);
                    }
                  }}
                >
                  <option value="auto">
                    From instruction ({actionForInstruction(prompt, prd)})
                  </option>
                  <option value="ask">Ask</option>
                  <option value="rewrite">Rewrite</option>
                  <option value="draft">Draft</option>
                  <option value="review">Review</option>
                </select>
              </label>
              <label>
                <span>Apply to</span>
                <select
                  value={scope}
                  disabled={documentMutationBusy}
                  onChange={(event) => {
                    if (!documentMutationRef.current) setScope(event.target.value as ActionScope);
                  }}
                >
                  <option value="section">Section</option>
                  <option value="selection" disabled={!selection}>
                    Selection{selection ? '' : ' unavailable'}
                  </option>
                  <option value="document">Whole PRD</option>
                </select>
              </label>
            </div>
            <p className="scope-caption">
              {proposalContext
                ? `Proposal target: ${proposalTargetLabel}`
                : scope === 'section'
                  ? (selectedSection?.title ?? 'Choose a section')
                  : scope === 'selection'
                    ? `${selection.length} selected characters`
                    : `${prd.sections.length} sections`}
            </p>

            <PromptInput
              onSubmit={async ({ text }) => {
                if (await submitAction(text))
                  setPrompt((current) => (current === text ? '' : current));
              }}
              className="assist-input"
            >
              <PromptInputTextarea
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                placeholder="Describe a PRD, ask for a review, or explain what to change…"
                aria-label="Your instruction"
                disabled={documentMutationBusy || recoveryUnavailable}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.stopPropagation();
                    if (event.metaKey || event.ctrlKey) {
                      event.preventDefault();
                      if (!busy) event.currentTarget.form?.requestSubmit();
                    }
                  }
                }}
              />
              <PromptInputFooter>
                <PromptInputTools>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Attach source files"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSourcesOpen(true)}
                  >
                    {uploading
                      ? 'Adding files…'
                      : `${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={documentMutationBusy}
                    onClick={() => setProviderOpen(true)}
                  >
                    <KeyRound aria-hidden="true" />
                    {project.selectedProvider
                      ? `${project.selectedProvider === 'ollama' ? 'Local' : 'Online'} · ${project.selectedModel ?? project.selectedProvider}`
                      : 'AI settings'}
                  </Button>
                </PromptInputTools>
                <PromptInputSubmit
                  status={busy ? 'streaming' : 'ready'}
                  disabled={
                    documentMutationBusy ||
                    (!busy && offline && project.selectedProvider !== 'ollama')
                  }
                  onClick={(event) => {
                    if (busy) {
                      event.preventDefault();
                      abortRef.current?.abort();
                    }
                  }}
                />
              </PromptInputFooter>
            </PromptInput>
            <p className="composer-caption">
              {project.selectedProvider
                ? activeProviderState?.configured
                  ? project.selectedProvider === 'ollama'
                    ? 'Local model must be running.'
                    : 'Relevant source excerpts and document context are sent to the selected online provider.'
                  : 'Selected provider needs setup. Your work remains available.'
                : 'AI is optional. Edit the document or use manual handoff in History.'}{' '}
              <span>⌘ Return to send</span>
            </p>
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
                disabled={
                  busy || documentMutationBusy || (offline && project.selectedProvider !== 'ollama')
                }
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
                            disabled={documentMutationBusy || recoveryUnavailable}
                            onChange={(event) => {
                              if (documentMutationRef.current || recoveryUnavailable) return;
                              setFindingDrafts((current) => ({
                                ...current,
                                [finding.id]: event.target.value,
                              }));
                            }}
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
                          !finding.proposedPatch ||
                          finding.sourceRevision !== prd.revision ||
                          dirty ||
                          documentMutationBusy
                        }
                        onClick={() =>
                          void acceptFinding(finding).catch(
                            (reason: unknown) => void handleFindingError(reason),
                          )
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
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
                  evidence you select below. OpenAI processes this material inside ChatGPT. This
                  handoff works separately from the optional ChatGPT plan provider in AI settings.
                </p>
                <label>
                  <span>Instruction</span>
                  <textarea
                    value={handoffInstruction}
                    disabled={documentMutationBusy || recoveryUnavailable}
                    onChange={(event) => {
                      if (!documentMutationRef.current) setHandoffInstruction(event.target.value);
                    }}
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
                          disabled={documentMutationBusy || recoveryUnavailable}
                          onChange={(event) => {
                            if (documentMutationRef.current) return;
                            setHandoffCitationIds((current) =>
                              event.target.checked
                                ? [...current, citation.id]
                                : current.filter((id) => id !== citation.id),
                            );
                          }}
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
                    disabled={!handoffInstruction.trim() || dirty || documentMutationBusy}
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
                    disabled={documentMutationBusy}
                    onClick={() => handoffInputRef.current?.click()}
                  >
                    <Upload aria-hidden="true" />
                    Import response
                  </Button>
                  <input
                    ref={handoffInputRef}
                    className="visually-hidden"
                    type="file"
                    hidden
                    accept="application/json,.json"
                    aria-label="Import ChatGPT handoff response"
                    disabled={documentMutationBusy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file && !documentMutationRef.current) {
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
                                disabled={
                                  documentMutationBusy ||
                                  recoveryUnavailable ||
                                  handoff.status !== 'staged'
                                }
                                onChange={(event) => {
                                  if (documentMutationRef.current || recoveryUnavailable) return;
                                  setHandoffDrafts((current) => ({
                                    ...current,
                                    [handoff.id]: {
                                      ...current[handoff.id],
                                      [patch.sectionId]: event.target.checked
                                        ? patch.afterMarkdown
                                        : null,
                                    },
                                  }));
                                }}
                              />
                              Apply to {sectionTitle}
                            </span>
                            <textarea
                              disabled={
                                documentMutationBusy ||
                                recoveryUnavailable ||
                                !enabled ||
                                handoff.status !== 'staged'
                              }
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
                        disabled={
                          handoff.sourceRevision !== prd.revision || dirty || documentMutationBusy
                        }
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
                      disabled={documentMutationBusy}
                      onClick={() => {
                        if (documentMutationRef.current) return;
                        void api
                          .dismissChatGptHandoff(project.id, handoff.id)
                          .then(() =>
                            setHandoffs((current) =>
                              current.filter((item) => item.id !== handoff.id),
                            ),
                          )
                          .catch((reason: unknown) => setError(messageFrom(reason)));
                      }}
                    >
                      {handoff.status === 'applied' ? 'Retire handoff' : 'Delete handoff'}
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
                    disabled={revision.revision === prd.revision || dirty || documentMutationBusy}
                    onClick={() => {
                      if (
                        !window.confirm(`Restore revision ${revision.revision} as a new revision?`)
                      )
                        return;
                      void runDocumentMutation(async () => {
                        const restored = await api.restoreRevision(
                          project.id,
                          revision.revision,
                          prd.revision,
                        );
                        setPrd(restored);
                        setSavedPrd(restored);
                        setUndoRevision(null);
                        setRevisions((await api.revisions(project.id)).revisions);
                      }).catch((reason: unknown) => setError(messageFrom(reason)));
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
                          if (documentMutationRef.current) return;
                          if (busy) return;
                          setInterrupted(run.status !== 'completed');
                          setAction(run.action);
                          setScope(run.scope);
                          setOutput(
                            proposalDraft?.runId === run.id
                              ? proposalDraft.text
                              : (run.outputText ?? ''),
                          );
                          setCitations(run.citations);
                          setHandoffCitationIds([]);
                          setProposalContext(contextForRun(run, prd.revision));
                          setActiveTurnId(turns.find((turn) => turn.runId === run.id)?.id ?? null);
                          setSubmittedPrompt('');
                          setDocumentOpen(false);
                          setTab('assist');
                        }}
                        disabled={documentMutationBusy || busy}
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
      </main>
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

      <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <DialogContent className="workspace-sheet">
          <DialogTitle>Sources</DialogTitle>
          <DialogDescription>
            Local files used as evidence. Importing a file does not make it a document template.
          </DialogDescription>
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
            {sources.length === 0 ? (
              <button className="empty-source" onClick={() => fileInputRef.current?.click()}>
                Add evidence
                <small>PDF, Word, slides, sheets, JPEG, or text</small>
              </button>
            ) : (
              sources.map((source) => (
                <div className="source-item" key={source.id}>
                  <div>
                    <strong>{source.name}</strong>
                    <small>
                      {source.status === 'processing' ? 'Extracting and indexing…' : source.status}
                    </small>
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
                    disabled={busy || documentMutationBusy}
                    onClick={() => {
                      if (!window.confirm(`Delete ${source.name} and its index?`)) return;
                      void removeSource(source);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))
            )}
          </section>
          <p className="sheet-note">
            PDF, Word, slides, spreadsheets, JPEG and text · Up to 25 MB per file. Check extraction
            warnings before relying on a source.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={structureOpen} onOpenChange={setStructureOpen}>
        <DialogContent className="workspace-sheet">
          <DialogTitle>Document structure</DialogTitle>
          <DialogDescription>
            Choose headings and purpose for this project. Existing content is preserved or a
            conflict is reported before changes are applied.
          </DialogDescription>
          <StructurePanel
            project={project}
            document={prd}
            onApply={async (structureId) => {
              if (recoveryUnavailable)
                throw new Error('Reload when recovery is available before changing structure.');
              if (recoveryConflict)
                throw new Error('Review recovered edits before changing structure.');
              const current = dirty ? await save('Saved before structure change') : prd;
              if (!current)
                throw new Error('Save the current document before changing its structure.');
              const result = await api.selectStructure(project.id, structureId, current.revision);
              setPrd(result.prd);
              setSavedPrd(result.prd);
              setSelectedSectionId(result.prd.sections[0]?.id ?? '');
              onProjectChange(result.project);
              setRevisions((await api.revisions(project.id)).revisions);
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="workspace-sheet export-sheet">
          <DialogTitle>Export document</DialogTitle>
          <DialogDescription>
            The latest edits are saved before export. Export works without AI or an internet
            connection.
          </DialogDescription>
          <div className="export-row">
            <span>Export</span>
            {(['pdf', 'docx', 'markdown', 'archive'] as const).map((format) => (
              <button
                type="button"
                key={
                  format === 'docx'
                    ? 'Word (.docx)'
                    : format === 'pdf'
                      ? 'PDF'
                      : format === 'archive'
                        ? 'Project archive'
                        : 'Markdown'
                }
                disabled={documentMutationBusy || saveBusy}
                onClick={() => void exportCurrent(format)}
              >
                <Download aria-hidden="true" />
                {format === 'docx'
                  ? 'Word (.docx)'
                  : format === 'pdf'
                    ? 'PDF'
                    : format === 'archive'
                      ? 'Project archive'
                      : 'Markdown'}
              </button>
            ))}
          </div>
          <p role="status">{exportStatus}</p>
        </DialogContent>
      </Dialog>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="workspace-sheet">
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Keep a PRD, its instructions and sources together on this Mac.
          </DialogDescription>
          <form
            className="new-project-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createAnotherProject();
            }}
          >
            <label htmlFor="new-project-name">Project name</label>
            <input
              id="new-project-name"
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              maxLength={120}
              autoFocus
            />
            <Button type="submit" disabled={!newProjectName.trim() || busy || documentMutationBusy}>
              Create project
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}>
        <DialogContent className="workspace-sheet">
          <DialogTitle>Recovered edits</DialogTitle>
          <DialogDescription>
            These edits are from version {recoveryConflict?.baseRevision}. The saved document is
            version {prd.revision}. Replacing the editor does not change saved history until you
            save.
          </DialogDescription>
          <div className="recovery-document">
            {recoveryConflict?.sections.map((section) => (
              <section key={section.id}>
                <h3>{section.title}</h3>
                <pre>{section.body}</pre>
              </section>
            ))}
          </div>
          <Button
            disabled={busy || documentMutationBusy}
            onClick={() => {
              if (!recoveryConflict) return;
              setPrd({ ...prd, sections: recoveryConflict.sections });
              setRecoveryConflict(null);
              setRecoveryOpen(false);
              setDocumentOpen(true);
            }}
          >
            Use recovered edits in editor
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (window.confirm('Discard this recovery copy and keep the saved document?')) {
                setRecoveryConflict(null);
                setRecoveryOpen(false);
              }
            }}
          >
            Keep saved document and discard recovery
          </Button>
        </DialogContent>
      </Dialog>
      {providerOpen && (
        <ProviderDialog
          key={project.id}
          open
          project={project}
          onOpenChange={setProviderOpen}
          onProjectChange={onProjectChange}
        />
      )}
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

function truncateText(value: string, limit = 160): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 3)}...`;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation could not be completed.';
}

function actionForInstruction(instruction: string, document: PrdDocument): AiAction {
  const text = instruction.trim().toLowerCase();
  if (/^(draft|create|write|start|generate)\b/.test(text)) return 'draft';
  if (/\b(review|critique|audit|assess|find gaps|check for)\b/.test(text)) return 'review';
  if (
    /\b(rewrite|revise|update|change|improve|replace|add|remove)\b/.test(text) &&
    document.sections.some((section) => section.body.trim())
  )
    return 'rewrite';
  if (/^(what|why|how|which|where|when|can you explain|explain)\b/.test(text)) return 'ask';
  return document.sections.some((section) => section.body.trim()) ? 'ask' : 'draft';
}

function contextForRun(run: AiRunProposal, revision: number): ProposalContext | null {
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
  };
}
