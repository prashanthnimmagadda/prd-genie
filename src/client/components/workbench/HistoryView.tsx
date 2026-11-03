import { useState, type Dispatch, type SetStateAction } from 'react';
import { Check, Copy, Download, RotateCcw } from 'lucide-react';
import type {
  ActionScope,
  AiRunProposal,
  ChatGptHandoffSummary,
  Citation,
  PrdDocument,
  RevisionSummary,
} from '@shared/types';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  formatDay,
  formatDayTime,
  formatTime,
  messageFrom,
  revisionLabel,
  sectionNumber,
} from '@/lib/format';
import { providerLabels } from '@/lib/provider-display';

export type HistoryTab = 'revisions' | 'runs';

interface HistoryViewProps {
  tab: HistoryTab;
  revisions: RevisionSummary[];
  aiRuns: AiRunProposal[];
  handoffs: ChatGptHandoffSummary[];
  prd: PrdDocument;
  selectedRevision: number | null;
  selectedRunId: string | null;
  busy: boolean;
  onSelectRevision: (revision: number) => void;
  onSelectRun: (id: string) => void;
  onRestore: (revision: RevisionSummary) => void;
  onInspectRun: (run: AiRunProposal) => void;
  onDismissHandoff: (handoff: ChatGptHandoffSummary) => void;
}

export function HistoryView({
  tab,
  revisions,
  aiRuns,
  handoffs,
  prd,
  selectedRevision,
  selectedRunId,
  busy,
  onSelectRevision,
  onSelectRun,
  onRestore,
  onInspectRun,
  onDismissHandoff,
}: HistoryViewProps) {
  const ordered = [...revisions].sort((a, b) => b.revision - a.revision);
  const selected = ordered.find((item) => item.revision === selectedRevision) ?? ordered[0];
  const runs = [...aiRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0];
  const selectedHandoff = handoffs.find((handoff) => handoff.id === selectedRunId);

  function sectionTitle(id: string | null): string {
    if (!id) return 'Whole PRD';
    const index = prd.sections.findIndex((section) => section.id === id);
    return index >= 0 ? prd.sections[index]!.title : 'Removed section';
  }

  function runStatus(run: AiRunProposal): string {
    return run.status === 'completed'
      ? 'Completed'
      : run.status === 'failed'
        ? 'Failed'
        : 'Stopped';
  }

  let lastDay = '';
  return (
    <div className="split">
      <div
        className="split-list history-list"
        role="listbox"
        aria-label={tab === 'revisions' ? 'Revisions' : 'AI runs'}
      >
        {tab === 'revisions'
          ? ordered.map((revision) => {
              const day = formatDay(revision.createdAt);
              const showDay = day !== lastDay;
              lastDay = day;
              return (
                <div key={revision.id}>
                  {showDay && (
                    <span
                      className={`t-label ${lastDay && revision !== ordered[0] ? 'group-gap' : ''}`}
                      style={{ display: 'block' }}
                    >
                      {day}
                    </span>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected?.id === revision.id}
                    className="revision-row history-row"
                    onClick={() => onSelectRevision(revision.revision)}
                  >
                    <span className="line">
                      <strong>Version {revision.revision}</strong>
                      {revision.revision === prd.revision && <span className="tag">Current</span>}
                    </span>
                    <span className="sub">
                      {formatTime(revision.createdAt)} · {revisionLabel(revision.reason)}
                    </span>
                  </button>
                </div>
              );
            })
          : [
              ...runs.map((run) => ({ kind: 'run' as const, id: run.id, at: run.startedAt, run })),
              ...handoffs.map((handoff) => ({
                kind: 'handoff' as const,
                id: handoff.id,
                at: handoff.createdAt,
                handoff,
              })),
            ]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((entry) => {
                const day = formatDay(entry.at);
                const showDay = day !== lastDay;
                lastDay = day;
                return (
                  <div key={entry.id}>
                    {showDay && (
                      <span className="t-label" style={{ display: 'block' }}>
                        {day}
                      </span>
                    )}
                    {entry.kind === 'run' ? (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selectedRun?.id === entry.id && !selectedHandoff}
                        className="revision-row history-row"
                        onClick={() => onSelectRun(entry.id)}
                      >
                        <span className="line">
                          <strong className="truncate">{entry.run.model}</strong>
                          <span className="tag">{runStatus(entry.run)}</span>
                        </span>
                        <span className="sub">
                          {formatTime(entry.at)} · {providerLabels[entry.run.provider]} ·{' '}
                          {entry.run.action === 'review'
                            ? 'Review'
                            : entry.run.action === 'ask'
                              ? 'Answer'
                              : 'Proposal'}{' '}
                          · {sectionTitle(entry.run.targetSectionId)} · {entry.run.citations.length}{' '}
                          {entry.run.citations.length === 1 ? 'excerpt' : 'excerpts'} · Based on
                          Version {entry.run.sourceRevision}
                          {entry.run.grounding?.status === 'review_required'
                            ? ' · Needs source review'
                            : ''}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selectedHandoff?.id === entry.id}
                        className="revision-row history-row"
                        onClick={() => onSelectRun(entry.id)}
                      >
                        <span className="line">
                          <strong>Manual handoff</strong>
                          <span className="tag">{handoffStatus(entry.handoff)}</span>
                        </span>
                        <span className="sub">
                          {formatTime(entry.at)} ·{' '}
                          {entry.handoff.scope === 'document' ? 'Whole PRD' : 'Section'} · Bound to
                          Version {entry.handoff.sourceRevision}
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
        {tab === 'runs' && runs.length === 0 && handoffs.length === 0 && (
          <p className="t-secondary" style={{ padding: '0 12px' }}>
            No AI runs yet. Replies and manual handoffs are listed here.
          </p>
        )}
      </div>
      <div className="split-detail history-detail">
        {tab === 'revisions' && selected && (
          <div className="split-detail-inner">
            <div className="detail-head">
              <div className="detail-title">
                <h2>Version {selected.revision}</h2>
                <span className="t-secondary">
                  {formatDayTime(selected.createdAt)} · {revisionLabel(selected.reason)}
                </span>
              </div>
              <button
                type="button"
                className="btn"
                disabled={busy || selected.revision === prd.revision}
                onClick={() => onRestore(selected)}
              >
                <RotateCcw aria-hidden="true" />
                Restore Version {selected.revision}…
              </button>
            </div>
            <p className="t-secondary">
              {selected.revision === prd.revision
                ? 'This is the current version.'
                : `Restoring creates Version ${prd.revision + 1} with this content. No revision is deleted.`}
            </p>
          </div>
        )}
        {tab === 'runs' && selectedHandoff && (
          <div className="split-detail-inner">
            <div className="detail-head">
              <div className="detail-title">
                <h2>Manual handoff</h2>
                <span className="t-secondary">
                  {formatDayTime(selectedHandoff.createdAt)} · {handoffStatus(selectedHandoff)} ·
                  Bound to Version {selectedHandoff.sourceRevision}
                </span>
              </div>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => onDismissHandoff(selectedHandoff)}
              >
                {selectedHandoff.status === 'applied' ? 'Remove from list' : 'Dismiss'}
              </button>
            </div>
            <div className="section-diff">
              <strong>Instruction</strong>
              <p className="run-output">{selectedHandoff.request.instruction}</p>
            </div>
            {selectedHandoff.response && (
              <div className="section-diff">
                <strong>Response summary</strong>
                <p className="run-output">{selectedHandoff.response.summary}</p>
              </div>
            )}
          </div>
        )}
        {tab === 'runs' && !selectedHandoff && selectedRun && (
          <div className="split-detail-inner">
            <div className="detail-head">
              <div className="detail-title">
                <h2>{selectedRun.model}</h2>
                <span className="t-secondary">
                  {formatDayTime(selectedRun.startedAt)} · {providerLabels[selectedRun.provider]} ·{' '}
                  {runStatus(selectedRun)} · {sectionTitle(selectedRun.targetSectionId)} · Based on
                  Version {selectedRun.sourceRevision}
                  {selectedRun.appliedRevision !== null
                    ? ` · Accepted as Version ${selectedRun.appliedRevision}`
                    : ''}
                </span>
              </div>
              {selectedRun.outputText && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => onInspectRun(selectedRun)}
                >
                  Open in conversation
                </button>
              )}
            </div>
            {selectedRun.grounding?.status === 'review_required' && (
              <p className="t-secondary" role="status">
                Needs source review: {selectedRun.grounding.reasons.join(' ')}
              </p>
            )}
            {selectedRun.errorCode && (
              <p className="t-secondary" role="status">
                Failed: {selectedRun.errorCode.replaceAll('_', ' ')}
              </p>
            )}
            <div className="section-diff">
              <strong>Output</strong>
              <p className="run-output">{selectedRun.outputText || 'No output was saved.'}</p>
            </div>
            {selectedRun.citations.length > 0 && (
              <div className="section-diff">
                <strong>Excerpts used</strong>
                {selectedRun.citations.map((citation, index) => (
                  <span key={citation.id} className="t-secondary">
                    {index + 1} · {citation.sourceName} · {citation.locator}
                    {citation.available ? '' : ' · source removed'}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === 'runs' && !selectedRun && !selectedHandoff && (
          <p className="t-secondary">Select a run to see what was sent back.</p>
        )}
      </div>
    </div>
  );
}

function handoffStatus(handoff: ChatGptHandoffSummary): string {
  switch (handoff.status) {
    case 'exported':
      return 'Prompt prepared';
    case 'staged':
      return 'Proposal ready';
    case 'stale':
      return 'Out of date';
    case 'applied':
      return 'Accepted';
    default:
      return 'Dismissed';
  }
}

export interface HandoffSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prd: PrdDocument;
  instruction: string;
  onInstructionChange: (value: string) => void;
  citations: Citation[];
  selectedCitationIds: string[];
  onToggleCitation: (id: string, checked: boolean) => void;
  disabled: boolean;
  dirty: boolean;
  onPrepare: (
    scope: ActionScope,
    sectionId: string | null,
  ) => Promise<ChatGptHandoffSummary | null>;
  onImportResponse: (text: string) => Promise<void>;
}

export function HandoffSheet({
  open,
  onOpenChange,
  prd,
  instruction,
  onInstructionChange,
  citations,
  selectedCitationIds,
  onToggleCitation,
  disabled,
  dirty,
  onPrepare,
  onImportResponse,
}: HandoffSheetProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sheet wide" showCloseButton={false} aria-busy={busy}>
        <HandoffSheetBody
          onOpenChange={onOpenChange}
          prd={prd}
          instruction={instruction}
          onInstructionChange={onInstructionChange}
          citations={citations}
          selectedCitationIds={selectedCitationIds}
          onToggleCitation={onToggleCitation}
          disabled={disabled}
          dirty={dirty}
          onPrepare={onPrepare}
          onImportResponse={onImportResponse}
          busy={busy}
          setBusy={setBusy}
        />
      </DialogContent>
    </Dialog>
  );
}

// The body mounts with the sheet, so its state resets every time the sheet opens.
function HandoffSheetBody({
  onOpenChange,
  prd,
  instruction,
  onInstructionChange,
  citations,
  selectedCitationIds,
  onToggleCitation,
  disabled,
  dirty,
  onPrepare,
  onImportResponse,
  busy,
  setBusy,
}: Omit<HandoffSheetProps, 'open'> & {
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
}) {
  const [scope, setScope] = useState<string>('document');
  const inputsKey = JSON.stringify([instruction, scope, selectedCitationIds]);
  const [preparedFor, setPreparedFor] = useState<{
    key: string;
    handoff: ChatGptHandoffSummary;
    copied: boolean;
  } | null>(null);
  const prepared = preparedFor?.key === inputsKey ? preparedFor.handoff : null;
  const copied = preparedFor?.key === inputsKey && preparedFor.copied;
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');

  const sectionId = scope === 'document' ? null : scope;
  const scopeLabel =
    scope === 'document'
      ? 'the Whole PRD'
      : `the ${prd.sections.find((section) => section.id === scope)?.title ?? 'section'} section`;

  async function ensurePrepared(): Promise<ChatGptHandoffSummary | null> {
    if (prepared) return prepared;
    setBusy(true);
    setError('');
    try {
      const handoff = await onPrepare(scope === 'document' ? 'document' : 'section', sectionId);
      if (handoff) setPreparedFor({ key: inputsKey, handoff, copied: false });
      return handoff;
    } catch (reason) {
      setError(messageFrom(reason));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    const handoff = await ensurePrepared();
    if (!handoff) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(handoff.request, null, 2));
      setPreparedFor((current) => (current ? { ...current, copied: true } : current));
    } catch {
      setError('The prompt could not be copied. Use Save as file… instead.');
    }
  }

  async function saveFile() {
    const handoff = await ensurePrepared();
    if (!handoff) return;
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

  async function createProposal() {
    setBusy(true);
    setError('');
    try {
      await onImportResponse(response);
      onOpenChange(false);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  }

  const canPrepare = Boolean(instruction.trim()) && !dirty && !disabled && !busy;
  return (
    <>
      <div className="sheet-title">
        <DialogTitle asChild>
          <h2>Manual handoff</h2>
        </DialogTitle>
        <DialogDescription asChild>
          <p>Use any chat tool, then bring its response back as a proposal you review.</p>
        </DialogDescription>
      </div>
      <div className="sheet-step">
        <strong>1 · Prepare a prompt package</strong>
        <div className="sheet-grid">
          <label htmlFor="handoff-instruction">Instruction</label>
          <input
            id="handoff-instruction"
            className="field"
            value={instruction}
            maxLength={10_000}
            disabled={disabled || busy}
            placeholder="Describe the draft, review, or rewrite you want proposed"
            onChange={(event) => onInstructionChange(event.target.value)}
          />
          <label htmlFor="handoff-scope">Apply to</label>
          <select
            id="handoff-scope"
            className="field"
            style={{ width: 200 }}
            value={scope}
            disabled={disabled || busy}
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="document">Whole PRD</option>
            {prd.sections.map((section, index) => (
              <option key={section.id} value={section.id}>
                {sectionNumber(index)} {section.title}
              </option>
            ))}
          </select>
        </div>
        {citations.length > 0 && (
          <fieldset className="sheet-indent" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="t-label" style={{ padding: '0 0 6px' }}>
              Excerpts to include
            </legend>
            {citations.map((citation) => (
              <label key={citation.id} className="check" style={{ alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={selectedCitationIds.includes(citation.id)}
                  disabled={disabled || busy || !citation.available}
                  onChange={(event) => onToggleCitation(citation.id, event.target.checked)}
                />
                <span style={{ fontSize: 12, lineHeight: '16px' }}>
                  {citation.sourceName}, {citation.locator}: {citation.excerpt}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <p className="t-secondary sheet-indent">
          Includes the instruction, {scopeLabel} and up to 8 excerpts from Sources. Bound to Version{' '}
          {prd.revision}.{dirty ? ' Save the PRD before preparing a package.' : ''}
        </p>
        <div className="sheet-row sheet-indent">
          <button
            type="button"
            className="btn"
            disabled={!canPrepare}
            onClick={() => void copyPrompt()}
          >
            <Copy aria-hidden="true" />
            Copy prompt
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canPrepare}
            onClick={() => void saveFile()}
          >
            <Download aria-hidden="true" />
            Save as file…
          </button>
          {copied && (
            <span className="copied" role="status">
              <Check aria-hidden="true" />
              Copied
            </span>
          )}
        </div>
      </div>
      <div className="sheet-sep" />
      <div className="sheet-step">
        <strong>2 · Paste the response</strong>
        <textarea
          className="field"
          aria-label="Paste the full response from the other chat tool"
          placeholder="Paste the full response from the other chat tool"
          value={response}
          disabled={disabled || busy}
          style={{ height: 120 }}
          onChange={(event) => setResponse(event.target.value)}
        />
        <p className="t-secondary">
          If the PRD changes after Version {prd.revision}, the proposal is marked out of date before
          you review it.
        </p>
      </div>
      {error && (
        <p className="t-secondary" role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      <div className="sheet-foot end">
        <button type="button" className="btn" disabled={busy} onClick={() => onOpenChange(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!response.trim() || busy || disabled}
          onClick={() => void createProposal()}
        >
          Create proposal
        </button>
      </div>
    </>
  );
}
