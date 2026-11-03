import {
  CircleAlert,
  CircleCheck,
  File,
  Files,
  FileText,
  FileWarning,
  FileX,
  Image,
  LoaderCircle,
  Presentation,
  Sheet,
} from 'lucide-react';
import type { SourceSummary } from '@shared/types';
import { fileKind, formatBytes, formatDayTime, type FileKind } from '@/lib/format';

export interface NotAddedFile {
  id: string;
  name: string;
  size: number;
  reason: 'Duplicate' | 'Too large' | 'Not supported' | 'Not added';
  detail: string;
}

export interface EvidenceDetail {
  sourceName: string;
  locator: string;
  excerpt: string;
  content: string;
  available: boolean;
}

interface SourcesViewProps {
  sources: SourceSummary[];
  notAdded: NotAddedFile[];
  selectedId: string | null;
  evidence: EvidenceDetail | null;
  uploading: boolean;
  busy: boolean;
  reduceMotion: boolean;
  onSelect: (id: string | null) => void;
  onAddFiles: () => void;
  onRetry: (source: SourceSummary) => void;
  onRemove: (source: SourceSummary) => void;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onClearEvidence: () => void;
}

const icons: Record<FileKind, typeof FileText> = {
  text: FileText,
  markdown: FileText,
  pdf: FileText,
  word: FileText,
  slides: Presentation,
  sheet: Sheet,
  image: Image,
  file: File,
};

function statusParts(source: SourceSummary): {
  label: string;
  tone: 'ready' | 'partial' | 'failed' | 'muted';
  detail: string;
} {
  const kind = fileKind(source.name, source.mediaType);
  switch (source.status) {
    case 'processing':
      return {
        label: kind.kind === 'image' ? 'Reading text in image…' : 'Reading…',
        tone: 'muted',
        detail: '',
      };
    case 'ready':
      return { label: 'Ready', tone: 'ready', detail: source.error || 'Fully read' };
    case 'partial':
      return {
        label: 'Partially read',
        tone: 'partial',
        detail: source.error || 'Some content was not understood',
      };
    default:
      return {
        label: 'Unreadable',
        tone: 'failed',
        detail: source.error || 'The file could not be read',
      };
  }
}

export function SourcesView({
  sources,
  notAdded,
  selectedId,
  evidence,
  uploading,
  busy,
  reduceMotion,
  onSelect,
  onAddFiles,
  onRetry,
  onRemove,
  onDismiss,
  onDismissAll,
  onClearEvidence,
}: SourcesViewProps) {
  const selected = sources.find((source) => source.id === selectedId) ?? null;
  return (
    <div className="split">
      <div className="sources-list" role="region" aria-label="Source files">
        <p className="sources-intro t-secondary">
          Sources are evidence for the assistant. They are never turned into a document structure.
          PDF, Word, PowerPoint, Excel, JPEG, Markdown and text, up to 25 MB each. Drop files
          anywhere in this view.
        </p>
        {uploading && (
          <p className="t-secondary" role="status" style={{ padding: '0 8px 8px' }}>
            Adding files…
          </p>
        )}
        {sources.length === 0 && !uploading ? (
          <div className="sources-empty">
            <strong>No sources yet</strong>
            <span className="t-secondary">
              Add files… or drop them here. Sources are evidence only.
            </span>
            <button
              type="button"
              className="btn"
              style={{ alignSelf: 'flex-start', marginTop: 8 }}
              onClick={onAddFiles}
            >
              Add files…
            </button>
          </div>
        ) : (
          <div role="listbox" aria-label="Sources" className="diff" style={{ gap: 4 }}>
            {sources.map((source) => {
              const kind = fileKind(source.name, source.mediaType);
              const Icon = icons[kind.kind];
              const status = statusParts(source);
              return (
                <div
                  key={source.id}
                  role="option"
                  aria-selected={source.id === selectedId}
                  tabIndex={0}
                  className="source-row"
                  onClick={() => onSelect(source.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(source.id);
                    }
                  }}
                >
                  {source.status === 'failed' ? (
                    <FileX className="danger" aria-hidden="true" />
                  ) : (
                    <Icon aria-hidden="true" />
                  )}
                  <div className="source-main">
                    <span className="name">{source.name}</span>
                    <span className="status" role="status">
                      {source.status === 'processing' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span>{status.label}</span>
                          {!reduceMotion && <span className="progress" aria-hidden="true" />}
                        </span>
                      ) : (
                        <>
                          <b className={status.tone}>{status.label}</b> · {status.detail}
                        </>
                      )}
                    </span>
                  </div>
                  <span className="kind">
                    {kind.label} · {formatBytes(source.size)}
                  </span>
                  <span className="action">
                    {(source.status === 'failed' || source.status === 'partial') && (
                      <button
                        type="button"
                        className="btn-link"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRetry(source);
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {notAdded.length > 0 && (
          <>
            <div className="not-added-head">
              <span className="t-label">Not added · {notAdded.length}</span>
              <button type="button" className="btn-link" onClick={onDismissAll}>
                Dismiss all
              </button>
            </div>
            {notAdded.map((item) => {
              const kind = fileKind(item.name);
              const Icon =
                item.reason === 'Duplicate'
                  ? Files
                  : item.reason === 'Too large'
                    ? FileWarning
                    : icons[kind.kind];
              return (
                <div key={item.id} className="source-row" role="status">
                  <Icon aria-hidden="true" />
                  <div className="source-main">
                    <span className="name" style={{ color: 'var(--text-tertiary)' }}>
                      {item.name}
                    </span>
                    <span className="status">
                      <b className="muted">{item.reason}</b> · {item.detail}
                    </span>
                  </div>
                  <span className="kind">
                    {kind.label}
                    {item.size ? ` · ${formatBytes(item.size)}` : ''}
                  </span>
                  <span className="action">
                    <button type="button" className="btn-link" onClick={() => onDismiss(item.id)}>
                      Dismiss
                    </button>
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
      <aside className="source-detail" aria-label="Source details">
        {evidence ? (
          <>
            <div className="detail-title">
              <strong>{evidence.sourceName}</strong>
              <span className="t-secondary">{evidence.locator}</span>
            </div>
            {!evidence.available && (
              <p className="t-secondary" role="status">
                Source removed. This excerpt is kept for history and can’t be cited again.
              </p>
            )}
            <div className="group">
              <span className="t-label">Cited excerpt</span>
              <blockquote>{evidence.excerpt}</blockquote>
            </div>
            {evidence.available && (
              <div className="group">
                <span className="t-label">In context</span>
                <div className="excerpt-content">{evidence.content}</div>
              </div>
            )}
            <div className="actions">
              <button type="button" className="btn" onClick={onClearEvidence}>
                Show file details
              </button>
            </div>
          </>
        ) : selected ? (
          <SourceDetail selected={selected} busy={busy} onRetry={onRetry} onRemove={onRemove} />
        ) : (
          <p className="t-secondary">Select a file to see how much of it was read.</p>
        )}
      </aside>
    </div>
  );
}

function SourceDetail({
  selected,
  busy,
  onRetry,
  onRemove,
}: {
  selected: SourceSummary;
  busy: boolean;
  onRetry: (source: SourceSummary) => void;
  onRemove: (source: SourceSummary) => void;
}) {
  const kind = fileKind(selected.name, selected.mediaType);
  const status = statusParts(selected);
  const StateIcon =
    selected.status === 'ready'
      ? CircleCheck
      : selected.status === 'processing'
        ? LoaderCircle
        : selected.status === 'partial'
          ? CircleAlert
          : FileX;
  return (
    <>
      <div className="detail-title">
        <strong>{selected.name}</strong>
        <span className="t-secondary">
          {kind.label} · {formatBytes(selected.size)} · Added {formatDayTime(selected.createdAt)}
        </span>
      </div>
      <div className="diff" style={{ gap: 12 }}>
        <span className={`state ${status.tone}`} role="status">
          <StateIcon
            aria-hidden="true"
            className={selected.status === 'processing' ? 'spin' : ''}
          />
          {status.label}
        </span>
        {selected.status !== 'failed' && selected.status !== 'processing' && (
          <div className="group">
            <span className="t-label">Read</span>
            <span>
              {selected.status === 'ready'
                ? 'All extractable text, indexed for retrieval'
                : 'The extractable text, indexed for retrieval'}
            </span>
          </div>
        )}
        {(selected.status === 'partial' || selected.status === 'failed') && (
          <div className="group">
            <span className="t-label">Not understood</span>
            <span>{status.detail}</span>
          </div>
        )}
        {selected.status === 'ready' && selected.error && (
          <div className="group">
            <span className="t-label">Note</span>
            <span>{selected.error}</span>
          </div>
        )}
        <p className="t-secondary">
          The assistant sees only what was read. If missing content matters, describe it in the
          conversation.
        </p>
      </div>
      {(selected.status === 'partial' || selected.status === 'failed') && (
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={() => onRetry(selected)}>
            Retry
          </button>
        </div>
      )}
      <button
        type="button"
        className="btn-link danger"
        disabled={busy}
        onClick={() => onRemove(selected)}
      >
        Remove from project…
      </button>
    </>
  );
}
