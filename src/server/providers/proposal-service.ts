import { ApiError } from '../../shared/api.js';
import type { PrdDocument, PrdSection } from '../../shared/types.js';
import type { Repository } from '../db/repository.js';

export class ProposalService {
  constructor(private readonly repository: Repository) {}

  apply(
    projectId: string,
    runId: string,
    expectedRevision: number,
    proposedMarkdown?: string,
  ): PrdDocument {
    const run = this.repository.getAiRun(projectId, runId);
    if (run.status !== 'completed' || !run.outputText) {
      throw new ApiError(409, 'proposal_incomplete', 'This AI proposal is not complete.');
    }
    if (run.appliedRevision !== null) {
      throw new ApiError(409, 'proposal_applied', 'This AI proposal was already applied.');
    }
    if (run.action === 'ask' || run.action === 'review') {
      throw new ApiError(400, 'proposal_not_applicable', 'This AI action cannot change the PRD.');
    }
    const current = this.repository.getPrd(projectId);
    if (current.revision !== expectedRevision || run.sourceRevision !== expectedRevision) {
      throw new ApiError(409, 'stale_proposal', 'This proposal targets an older PRD revision.');
    }
    const output = (proposedMarkdown ?? run.outputText).trim();
    if (!output) throw new ApiError(400, 'empty_proposal', 'The proposal is empty.');

    const sections =
      run.scope === 'document'
        ? parseDocumentProposal(output, current.sections)
        : applyScopedProposal(current.sections, run.targetSectionId, run.selectionText, output);
    const revised = proposedMarkdown !== undefined && proposedMarkdown !== run.outputText;
    const saved = this.repository.savePrd(
      projectId,
      expectedRevision,
      sections,
      `AI run ${runId} ${revised ? 'revised and accepted' : 'accepted'}`,
    );
    this.repository.markAiRunApplied(projectId, runId, saved.revision);
    return saved;
  }
}

function applyScopedProposal(
  sections: PrdSection[],
  targetSectionId: string | null,
  selectionText: string | null,
  output: string,
): PrdSection[] {
  const target = sections.find((section) => section.id === targetSectionId);
  if (!target) throw new ApiError(409, 'target_missing', 'The proposal target no longer exists.');
  let body = normalizeSectionBody(output, target.title);
  if (selectionText !== null) {
    const first = target.body.indexOf(selectionText);
    const last = target.body.lastIndexOf(selectionText);
    if (first < 0 || first !== last) {
      throw new ApiError(
        409,
        'selection_changed',
        'The selected text changed or is no longer unique.',
      );
    }
    body = `${target.body.slice(0, first)}${output}${target.body.slice(first + selectionText.length)}`;
  }
  return sections.map((section) => (section.id === target.id ? { ...section, body } : section));
}

export function normalizeSectionBody(output: string, title: string): string {
  const heading = /^#{1,6}[ \t]+([^\n]+)\n+/;
  const match = output.match(heading);
  if (!match) return output;
  if (!sectionHeadingMatchesTitle(match[1] ?? '', title)) {
    throw new ApiError(
      502,
      'malformed_output',
      'The proposal returned a heading for a different section.',
    );
  }
  return output.slice(match[0].length).trim();
}

function sectionHeadingMatchesTitle(heading: string, title: string): boolean {
  const normalize = (value: string) =>
    value
      .trim()
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s&-]/gu, '')
      .replace(/\s+/g, ' ');
  const normalizedHeading = normalize(heading);
  const normalizedTitle = normalize(title);
  if (normalizedHeading === normalizedTitle) return true;
  return normalizedTitle
    .split(/\s+(?:and|&)\s+/)
    .filter((part) => part.length >= 4)
    .includes(normalizedHeading);
}

export function normalizeDocumentProposal(output: string, sections: PrdSection[]): string {
  const parsed = parseDocumentProposal(output, sections);
  return parsed
    .map((section) => `<!-- section:${section.id} -->\n## ${section.title}\n${section.body}`)
    .join('\n\n');
}

export function parseDocumentProposal(output: string, sections: PrdSection[]): PrdSection[] {
  const marker =
    /<!--\s*section:([0-9a-f-]{36})\s*-->\s*\n##[ \t]+[^\n]*\n([\s\S]*?)(?=\n<!--\s*section:|\s*$)/gi;
  const bodies = new Map<string, string>();
  for (const match of output.matchAll(marker)) {
    const id = match[1];
    const body = match[2];
    if (!id || body === undefined || bodies.has(id)) {
      throw new ApiError(502, 'malformed_output', 'The document proposal has invalid sections.');
    }
    bodies.set(id, body.trim());
  }
  const knownIds = new Set(sections.map((section) => section.id));
  if (
    bodies.size !== sections.length ||
    [...bodies.keys()].some((id) => !knownIds.has(id)) ||
    sections.some((section) => !bodies.has(section.id))
  ) {
    throw new ApiError(
      502,
      'malformed_output',
      'The document proposal must contain every current section exactly once.',
    );
  }
  return sections.map((section) => ({ ...section, body: bodies.get(section.id) ?? section.body }));
}
