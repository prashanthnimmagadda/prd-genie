import { Ellipsis, Plus } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { PrdDocument, ProjectSummary } from '@shared/types';
import { SectionEditor } from '@/components/SectionEditor';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { sectionNumber } from '@/lib/format';

interface DocumentViewProps {
  project: ProjectSummary;
  prd: PrdDocument;
  structureName: string;
  selectedSectionId: string;
  flashSectionId: string | null;
  disabled: boolean;
  onSelectSection: (id: string) => void;
  onSelectionChange: (text: string) => void;
  onTitleChange: (id: string, title: string) => void;
  onBodyChange: (id: string, body: string) => void;
  onMoveSection: (index: number, to: number) => void;
  onRemoveSection: (id: string) => void;
  onAddSection: () => void;
  onEditorReady: (sectionId: string, editor: Editor | null) => void;
}

export function DocumentView({
  project,
  prd,
  structureName,
  selectedSectionId,
  flashSectionId,
  disabled,
  onSelectSection,
  onSelectionChange,
  onTitleChange,
  onBodyChange,
  onMoveSection,
  onRemoveSection,
  onAddSection,
  onEditorReady,
}: DocumentViewProps) {
  const requiredEmpty = prd.sections.filter(
    (section) => section.required && !section.body.trim(),
  ).length;
  const meta = [
    project.description || null,
    `${structureName} structure`,
    requiredEmpty
      ? `${requiredEmpty} required ${requiredEmpty === 1 ? 'section' : 'sections'} empty`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <article className="document-article">
      <div className="document-title">
        <span className="t-secondary">Product requirements document</span>
        <h1>{project.name}</h1>
        <span className="t-secondary">{meta}</span>
      </div>
      {prd.sections.map((section, index) => (
        <section
          key={section.id}
          id={`section-${section.id}`}
          className={`doc-section ${flashSectionId === section.id ? 'flash' : ''}`}
          aria-current={section.id === selectedSectionId ? 'true' : undefined}
        >
          <span className="num" aria-hidden="true">
            {sectionNumber(index)}
          </span>
          <div className="doc-heading">
            <input
              aria-label="Section title"
              value={section.title}
              maxLength={160}
              disabled={disabled}
              onFocus={() => onSelectSection(section.id)}
              onChange={(event) => onTitleChange(section.id, event.target.value)}
            />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="btn btn-icon section-menu"
                  aria-label={`More for ${section.title}`}
                  disabled={disabled}
                >
                  <Ellipsis aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="genie-menu" align="end">
                <DropdownMenuItem
                  disabled={index === 0}
                  onSelect={() => onMoveSection(index, index - 1)}
                >
                  <span className="mark" />
                  <span className="grow">Move up</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={index === prd.sections.length - 1}
                  onSelect={() => onMoveSection(index, index + 1)}
                >
                  <span className="mark" />
                  <span className="grow">Move down</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={prd.sections.length === 1}
                  onSelect={() => onRemoveSection(section.id)}
                >
                  <span className="mark" />
                  <span className="grow">Remove section…</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <span aria-hidden="true" />
          <SectionEditor
            sectionId={section.id}
            value={section.body}
            placeholder={`${section.required ? 'Required' : 'Optional'}. ${section.purpose ?? 'Add what this section must cover.'}`}
            disabled={disabled}
            onFocus={() => onSelectSection(section.id)}
            onSelectionChange={onSelectionChange}
            onChange={(body) => onBodyChange(section.id, body)}
            onReady={onEditorReady}
          />
        </section>
      ))}
      <button
        type="button"
        className="add-link add-section"
        disabled={disabled}
        onClick={onAddSection}
      >
        <Plus aria-hidden="true" />
        Add section
      </button>
    </article>
  );
}
