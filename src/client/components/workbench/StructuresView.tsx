import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Ellipsis, GripVertical, Lock, Plus, X } from 'lucide-react';
import type { StructureSection, StructureTemplate } from '@shared/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { sectionNumber } from '@/lib/format';

export const BUILT_IN_STRUCTURE_ID = 'built-in-default';

export interface StructureEntry {
  id: string;
  name: string;
  sections: StructureSection[];
  builtIn: boolean;
}

interface StructuresViewProps {
  builtIn: StructureEntry;
  structures: StructureTemplate[];
  selectedId: string;
  activeStructureId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: { name?: string; sections?: StructureSection[] }) => Promise<void>;
  onDuplicate: (entry: StructureEntry) => void;
  onDelete: (structure: StructureTemplate) => void;
}

export function StructuresView({
  builtIn,
  structures,
  selectedId,
  activeStructureId,
  busy,
  onSelect,
  onUpdate,
  onDuplicate,
  onDelete,
}: StructuresViewProps) {
  const selected: StructureEntry | null =
    selectedId === builtIn.id
      ? builtIn
      : (() => {
          const found = structures.find((item) => item.id === selectedId);
          return found
            ? { id: found.id, name: found.name, sections: found.sections, builtIn: false }
            : null;
        })();
  return (
    <div className="split">
      <div className="split-list" role="listbox" aria-label="Structures" style={{ width: 300 }}>
        <span className="t-label">Built in</span>
        <button
          type="button"
          role="option"
          aria-selected={selectedId === builtIn.id}
          className="list-row"
          onClick={() => onSelect(builtIn.id)}
        >
          <div>
            <span className="title">{builtIn.name}</span>
            <span className="sub">
              {builtIn.sections.length} sections · read-only
              {activeStructureId === builtIn.id ? ' · this project' : ''}
            </span>
          </div>
          <Lock aria-hidden="true" />
        </button>
        <span className="t-label group-gap">Yours</span>
        {structures.map((structure) => (
          <button
            key={structure.id}
            type="button"
            role="option"
            aria-selected={selectedId === structure.id}
            className="list-row structure-option"
            onClick={() => onSelect(structure.id)}
          >
            <div>
              <span className="title truncate">{structure.name}</span>
              <span className="sub">
                {structure.sections.length}{' '}
                {structure.sections.length === 1 ? 'section' : 'sections'}
                {activeStructureId === structure.id ? ' · this project' : ''}
              </span>
            </div>
          </button>
        ))}
        {structures.length === 0 && (
          <span className="t-secondary" style={{ padding: '0 12px' }}>
            Duplicate the built-in structure or press New structure.
          </span>
        )}
      </div>
      <div className="split-detail">
        {selected ? (
          <StructureEditor
            key={selected.id}
            entry={selected}
            busy={busy}
            onUpdate={onUpdate}
            onDuplicate={onDuplicate}
            onDelete={() => {
              const structure = structures.find((item) => item.id === selected.id);
              if (structure) onDelete(structure);
            }}
          />
        ) : (
          <p className="t-secondary">Select a structure to see its sections.</p>
        )}
      </div>
    </div>
  );
}

function StructureEditor({
  entry,
  busy,
  onUpdate,
  onDuplicate,
  onDelete,
}: {
  entry: StructureEntry;
  busy: boolean;
  onUpdate: (id: string, patch: { name?: string; sections?: StructureSection[] }) => Promise<void>;
  onDuplicate: (entry: StructureEntry) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(entry.name);
  const [sections, setSections] = useState<StructureSection[]>(entry.sections);
  const [saveError, setSaveError] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const pending = useRef<{ name: string; sections: StructureSection[] } | null>(null);
  const readOnly = entry.builtIn;
  const issue = readOnly ? '' : validate(name, sections);
  const problem = issue || saveError;

  useEffect(() => {
    if (readOnly) return;
    const draft = { name, sections };
    if (
      draft.name === entry.name &&
      JSON.stringify(draft.sections) === JSON.stringify(entry.sections)
    )
      return;
    if (issue) return;
    pending.current = draft;
    const timer = window.setTimeout(() => {
      const next = pending.current;
      if (!next) return;
      setSaveState('saving');
      void onUpdate(entry.id, {
        ...(next.name !== entry.name ? { name: next.name.trim() } : {}),
        ...(JSON.stringify(next.sections) !== JSON.stringify(entry.sections)
          ? {
              sections: next.sections.map((section) => ({
                ...section,
                title: section.title.trim(),
                purpose: section.purpose.trim(),
              })),
            }
          : {}),
      })
        .then(() => {
          setSaveState('saved');
          setSaveError('');
        })
        .catch((reason: unknown) => {
          setSaveState('idle');
          setSaveError(
            reason instanceof Error ? reason.message : 'The structure could not be saved.',
          );
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [name, sections, entry, onUpdate, readOnly, issue]);

  function updateSection(index: number, patch: Partial<StructureSection>) {
    setSections((current) =>
      current.map((section, position) => (position === index ? { ...section, ...patch } : section)),
    );
  }

  function move(index: number, to: number) {
    if (to < 0 || to >= sections.length) return;
    setSections((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  }

  return (
    <div className="split-detail-inner" style={{ maxWidth: 760 }}>
      <div className="detail-head" style={{ gap: 12 }}>
        <div className="detail-title">
          {readOnly ? (
            <h2>{entry.name}</h2>
          ) : (
            <input
              className="detail-name"
              aria-label="Structure name"
              value={name}
              maxLength={120}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          )}
          <span className="t-secondary">
            {readOnly
              ? 'The default 13-section PRD. Duplicate it to customise.'
              : saveState === 'saving'
                ? 'Saving…'
                : saveState === 'saved'
                  ? 'Saved'
                  : 'Edits save automatically.'}
          </span>
        </div>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="btn btn-icon" aria-label="More" disabled={busy}>
              <Ellipsis aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="genie-menu" align="end">
            <DropdownMenuItem onSelect={() => onDuplicate(entry)}>
              <span className="mark" />
              <span className="grow">Duplicate</span>
            </DropdownMenuItem>
            {!readOnly && (
              <DropdownMenuItem onSelect={onDelete}>
                <span className="mark" />
                <span className="grow">Delete structure…</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="structure-table" role="table" aria-label={`${entry.name} sections`}>
        <div className="structure-head" role="row">
          <span />
          <span />
          <span role="columnheader">Section</span>
          <span role="columnheader">Purpose</span>
          <span role="columnheader">Required</span>
        </div>
        {sections.map((section, index) => (
          <div className="structure-row" role="row" key={index}>
            <GripVertical className="grip" aria-hidden="true" />
            <span className="num" role="cell">
              {sectionNumber(index)}
            </span>
            {readOnly ? (
              <span className="title-cell" role="cell">
                {section.title}
              </span>
            ) : (
              <input
                className="title-cell"
                role="cell"
                aria-label={`Section ${index + 1} title`}
                value={section.title}
                maxLength={160}
                disabled={busy}
                onChange={(event) => updateSection(index, { title: event.target.value })}
              />
            )}
            {readOnly ? (
              <span className="purpose-cell" role="cell">
                {section.purpose}
              </span>
            ) : (
              <input
                className="purpose-cell"
                role="cell"
                aria-label={`Section ${index + 1} purpose`}
                value={section.purpose}
                maxLength={1000}
                disabled={busy}
                onChange={(event) => updateSection(index, { purpose: event.target.value })}
              />
            )}
            <span className="end" role="cell">
              {!readOnly && (
                <span className="row-actions">
                  <button
                    type="button"
                    aria-label={`Move ${section.title || `section ${index + 1}`} up`}
                    disabled={busy || index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${section.title || `section ${index + 1}`} down`}
                    disabled={busy || index === sections.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${section.title || `section ${index + 1}`}`}
                    disabled={busy || sections.length === 1}
                    onClick={() =>
                      setSections((current) => current.filter((_, position) => position !== index))
                    }
                  >
                    <X aria-hidden="true" />
                  </button>
                </span>
              )}
              <button
                type="button"
                role="switch"
                className="switch"
                aria-checked={section.required}
                aria-label={`${section.title || `Section ${index + 1}`} required`}
                disabled={readOnly || busy}
                onClick={() => updateSection(index, { required: !section.required })}
              />
            </span>
          </div>
        ))}
      </div>
      {!readOnly && (
        <button
          type="button"
          className="add-link"
          disabled={busy}
          onClick={() =>
            setSections((current) => [
              ...current,
              {
                title: `Section ${current.length + 1}`,
                purpose: 'Describe what this section must cover',
                required: false,
              },
            ])
          }
        >
          <Plus aria-hidden="true" />
          Add section
        </button>
      )}
      {problem && (
        <p className="t-secondary" role="alert" style={{ color: 'var(--danger)' }}>
          {problem}
        </p>
      )}
      <p className="t-secondary" style={{ paddingLeft: 8 }}>
        Structures change only in this editor. Files in Sources never become structures.
      </p>
    </div>
  );
}

function validate(name: string, sections: StructureSection[]): string {
  if (!name.trim()) return 'Give the structure a name.';
  if (sections.length === 0) return 'Add at least one section.';
  if (sections.some((section) => !section.title.trim())) return 'Every section needs a title.';
  if (sections.some((section) => !section.purpose.trim())) return 'Every section needs a purpose.';
  const titles = sections.map((section) => section.title.trim().toLowerCase());
  if (new Set(titles).size !== titles.length) return 'Section titles must be unique.';
  return '';
}
