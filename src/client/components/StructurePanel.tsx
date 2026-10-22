import { useEffect, useState } from 'react';
import type {
  PrdDocument,
  ProjectSummary,
  StructureSection,
  StructureTemplate,
} from '@shared/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

export function StructurePanel({
  project,
  document,
  onApply,
}: {
  project: ProjectSummary;
  document: PrdDocument;
  onApply: (structureId: string) => Promise<void>;
}) {
  const [structures, setStructures] = useState<StructureTemplate[]>([]);
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState(() => fromDocument(document));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void api
      .structures(project.id)
      .then((result) => setStructures(result.structures))
      .catch((reason: unknown) => setError(message(reason)));
  }, [project.id]);

  async function create() {
    setError('');
    try {
      const sections = parseDefinition(definition);
      if (!name.trim()) throw new Error('Give the structure a name.');
      setBusy(true);
      const created = await api.createStructure(project.id, { name: name.trim(), sections });
      setStructures((current) => [...current, created]);
      setEditing(false);
      setName('');
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="structure-picker">
      <summary>Document structure</summary>
      <p>Keep the same headings through revisions, or choose a saved structure.</p>
      {structures.map((structure) => (
        <div className="structure-option" key={structure.id}>
          <span>
            {structure.name}
            {project.selectedStructureId === structure.id ? ' · active' : ''}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || project.selectedStructureId === structure.id}
            onClick={() => {
              setBusy(true);
              setError('');
              void onApply(structure.id)
                .catch((reason: unknown) => setError(message(reason)))
                .finally(() => setBusy(false));
            }}
          >
            Use
          </Button>
        </div>
      ))}
      {editing ? (
        <div className="structure-form">
          <label>
            Name
            <input
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="Client template"
            />
          </label>
          <label>
            Sections, one per line
            <textarea
              value={definition}
              rows={8}
              onChange={(event) => setDefinition(event.target.value)}
              aria-describedby="structure-format"
            />
          </label>
          <small id="structure-format">
            Heading | purpose | required or optional. The order is kept.
          </small>
          <div>
            <Button size="sm" disabled={busy} onClick={() => void create()}>
              Save structure
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDefinition(fromDocument(document));
            setEditing(true);
          }}
        >
          Save or enter a structure
        </Button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}

function fromDocument(document: PrdDocument): string {
  return document.sections
    .map(
      (section) =>
        `${section.title} | ${section.purpose ?? 'Describe what this section must cover'} | ${section.required === false ? 'optional' : 'required'}`,
    )
    .join('\n');
}

function parseDefinition(value: string): StructureSection[] {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error('Add at least one section.');
  const sections = lines.map((line, index) => {
    const parts = line.split('|').map((part) => part.trim());
    if (
      parts.length !== 3 ||
      !parts[0] ||
      !parts[1] ||
      !/^(required|optional)$/i.test(parts[2] ?? '')
    ) {
      throw new Error(`Line ${index + 1}: use Heading | purpose | required or optional.`);
    }
    return {
      title: parts[0],
      purpose: parts[1],
      required: parts[2]?.toLowerCase() === 'required',
    };
  });
  if (new Set(sections.map((section) => section.title.toLowerCase())).size !== sections.length)
    throw new Error('Section headings must be unique.');
  return sections;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The structure could not be saved.';
}
