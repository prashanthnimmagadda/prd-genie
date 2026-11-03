import { useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, ClockAlert, FileDiff, TriangleAlert } from 'lucide-react';
import type { Citation, GroundingAssessment } from '@shared/types';
import type { DiffLine } from '@/lib/format';
import { splitCitations, type CitationNumbers } from '@/lib/citations';

export function CitedText({ text, citations }: { text: string; citations?: CitationNumbers }) {
  return (
    <>
      {splitCitations(text, citations).map((part, index) =>
        typeof part === 'string' ? (
          part
        ) : (
          <span
            key={index}
            className="chip-cite"
            title={`Source ${part.numbers.join(', ')}`}
            aria-label={`Source ${part.numbers.join(', ')}`}
          >
            {part.numbers.join(', ')}
          </span>
        ),
      )}
    </>
  );
}

export function DiffView({
  lines,
  context = 2,
  citations,
}: {
  lines: DiffLine[];
  context?: number;
  citations?: CitationNumbers;
}) {
  const [expanded, setExpanded] = useState(false);
  const changed = lines.some((line) => line.type !== 'same');
  // Collapse long unchanged runs so the change stays visible.
  const visible: Array<DiffLine | { type: 'gap'; count: number }> = [];
  if (expanded || !changed) {
    visible.push(...lines);
  } else {
    let run: DiffLine[] = [];
    const flush = (atEnd: boolean, atStart: boolean) => {
      if (run.length <= context * 2 + 1 || (atStart && run.length <= context)) {
        visible.push(...run);
      } else {
        if (!atStart) visible.push(...run.slice(0, context));
        const hidden = run.length - (atStart ? 0 : context) - (atEnd ? 0 : context);
        if (hidden > 0) visible.push({ type: 'gap', count: hidden });
        if (!atEnd) visible.push(...run.slice(run.length - context));
      }
      run = [];
    };
    let started = false;
    lines.forEach((line, index) => {
      if (line.type === 'same') {
        run.push(line);
        if (index === lines.length - 1) flush(true, !started);
      } else {
        flush(false, !started);
        started = true;
        visible.push(line);
      }
    });
  }
  return (
    <div className="diff">
      {visible.map((line, index) =>
        line.type === 'gap' ? (
          <button
            key={`gap-${index}`}
            type="button"
            className="btn-link diff-more"
            onClick={() => setExpanded(true)}
          >
            Show {line.count} unchanged line{line.count === 1 ? '' : 's'}
          </button>
        ) : (
          <div key={index} className={`diff-line ${line.type}`}>
            <span className="marker" aria-hidden="true">
              {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ''}
            </span>
            <span className="visually-hidden">
              {line.type === 'add' ? 'Added: ' : line.type === 'del' ? 'Removed: ' : ''}
            </span>
            <span>{line.text ? <CitedText text={line.text} citations={citations} /> : ' '}</span>
          </div>
        ),
      )}
    </div>
  );
}

export function ProposalCard({
  ariaLabel,
  title,
  meta,
  children,
  footNote,
  footTone,
  actions,
  className = '',
}: {
  ariaLabel: string;
  title: string;
  meta?: string;
  children: ReactNode;
  footNote?: ReactNode;
  footTone?: 'warning';
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`} role="group" aria-label={ariaLabel}>
      <header className="card-head">
        <FileDiff aria-hidden="true" />
        <strong className="truncate" title={title}>
          {title}
        </strong>
        {meta && <span className="t-secondary">{meta}</span>}
      </header>
      <div className="card-body">{children}</div>
      {(footNote || actions) && (
        <footer className="card-foot">
          <span className={`foot-note ${footTone ?? ''}`}>{footNote}</span>
          {actions}
        </footer>
      )}
    </section>
  );
}

export function ReviewBlock({
  assessment,
  citations,
  onOpenCitation,
  children,
}: {
  assessment: GroundingAssessment;
  citations: Citation[];
  onOpenCitation: (citation: Citation) => void;
  children?: ReactNode;
}) {
  return (
    <section className="review-block" aria-label="Needs source review">
      <div className="review-head">
        <TriangleAlert aria-hidden="true" />
        <strong>Needs source review</strong>
        <span>
          {citations.length
            ? `${citations.length} excerpt${citations.length === 1 ? '' : 's'}`
            : ''}
        </span>
      </div>
      {citations.map((citation, index) => (
        <div className="review-excerpt" key={citation.id}>
          <button
            type="button"
            className="t-mono btn-link"
            style={{ justifyContent: 'flex-start', fontFamily: 'var(--font-mono)' }}
            onClick={() => onOpenCitation(citation)}
          >
            {index + 1} · {citation.sourceName} · {citation.locator}
            {citation.available ? '' : ' · source removed'}
          </button>
          <blockquote style={{ margin: 0 }}>
            <p>{citation.excerpt}</p>
          </blockquote>
        </div>
      ))}
      {citations.length === 0 && (
        <p className="review-why">
          No source excerpts were supplied. Compare the claims with your instructions and the
          current document.
        </p>
      )}
      {assessment.reasons.map((reason, index) => (
        <p className="review-why" key={index}>
          Why flagged: {reason}
        </p>
      ))}
      {children}
    </section>
  );
}

export function AcceptedRow({
  section,
  revision,
  onUndo,
  undoDisabled,
}: {
  section: string;
  revision: number;
  onUndo?: () => void;
  undoDisabled?: boolean;
}) {
  return (
    <div className="accepted-row" role="status">
      <CircleCheck aria-hidden="true" />
      <span>
        Accepted · {section} updated · Version {revision}
      </span>
      {onUndo && (
        <>
          <button type="button" className="btn-link" disabled={undoDisabled} onClick={onUndo}>
            Undo
          </button>
          <kbd aria-hidden="true">⌘Z</kbd>
        </>
      )}
    </div>
  );
}

export function StaleRow({
  basedOn,
  section,
  onRegenerate,
  onDismiss,
  disabled,
}: {
  basedOn: number;
  section: string;
  onRegenerate?: () => void;
  onDismiss: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="card-row" role="status">
      <ClockAlert className="warning" aria-hidden="true" />
      <span>
        <b>Out of date.</b> Based on Version {basedOn}; {section} has changed since.
      </span>
      {onRegenerate && (
        <button type="button" className="btn-link" disabled={disabled} onClick={onRegenerate}>
          Regenerate
        </button>
      )}
      <button type="button" className="btn-link" disabled={disabled} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

export function InvalidCitationRow({
  onRegenerate,
  onDismiss,
  disabled,
}: {
  onRegenerate?: () => void;
  onDismiss?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="card-row danger" role="alert">
      <CircleX aria-hidden="true" />
      <span>This proposal cites an excerpt that isn’t in Sources. It can’t be applied.</span>
      {onRegenerate && (
        <button type="button" className="btn-link" disabled={disabled} onClick={onRegenerate}>
          Regenerate
        </button>
      )}
      {onDismiss && (
        <button type="button" className="btn-link" disabled={disabled} onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}
