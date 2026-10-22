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
    if (run.citations.some((citation) => !citation.available)) {
      throw new ApiError(
        409,
        'stale_evidence',
        'This proposal cites evidence that is no longer available.',
      );
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
    return this.repository.saveAiRunApplication(
      projectId,
      runId,
      expectedRevision,
      sections,
      `AI run ${runId} ${revised ? 'revised and accepted' : 'accepted'}`,
    );
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
  const heading = /^#{1,2}[ \t]+([^\n]+)\n+/;
  const match = output.match(heading);
  if (!match) return output;
  if (!sectionHeadingMatchesTitle(match[1] ?? '', title, true)) {
    throw new ApiError(
      502,
      'malformed_output',
      'The proposal returned a heading for a different section.',
    );
  }
  return output.slice(match[0].length).trim();
}

function sectionHeadingMatchesTitle(
  heading: string,
  title: string,
  allowCompoundAbbreviation = false,
): boolean {
  const normalize = (value: string) =>
    value
      .trim()
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s&-]/gu, '')
      .replace(/\s+/g, ' ');
  const normalizedHeading = normalize(heading);
  const normalizedTitle = normalize(title);
  if (normalizedHeading === normalizedTitle) return true;
  if (!allowCompoundAbbreviation) return false;
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
  const blocks = output.trim().split(/(?=<!--\s*section:)/i);
  if (blocks.length > sections.length) {
    throw new ApiError(502, 'malformed_output', 'The document proposal has invalid sections.');
  }
  if (blocks.length !== sections.length) {
    throw new ApiError(
      502,
      'malformed_output',
      'The document proposal must contain every current section exactly once.',
    );
  }
  return sections.map((section, index) => {
    const match = blocks[index]
      ?.trim()
      .match(/^<!--\s*section:([0-9a-f-]{36})\s*-->\s*\r?\n##[ \t]+([^\r\n]+)\r?\n([\s\S]*)$/i);
    if (
      !match ||
      match[1] !== section.id ||
      !sectionHeadingMatchesTitle(match[2] ?? '', section.title)
    ) {
      throw new ApiError(
        502,
        'malformed_output',
        'The document proposal must follow the selected section headings and order exactly.',
      );
    }
    const body = (match[3] ?? '').trim();
    if (section.required && (!body || /^(?:tbd|todo|lorem ipsum|placeholder)\.?$/i.test(body))) {
      throw new ApiError(
        502,
        'incomplete_proposal',
        `The required "${section.title}" section is empty or a placeholder. The proposal is incomplete.`,
      );
    }
    return { ...section, body };
  });
}
