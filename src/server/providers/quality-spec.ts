import { DEFAULT_STRUCTURE_SECTIONS, type AiAction, type PrdSection } from '../../shared/types.js';

/** Versioned policy shared by every provider and PRD action. JSON is the task envelope, not a quality guarantee. */
export const PRD_QUALITY_SPEC_VERSION = '2026-10-25.1';

export const PRD_QUALITY_SPEC = [
  'Respond to the actual product request with specific, useful content; avoid generic PRD boilerplate, filler, and arbitrary length targets.',
  'Where relevant to the request and structure, make the problem, intended users, goals, scope, and exclusions clear.',
  'Make requirements actionable and acceptance criteria testable. Include relevant journeys, edge and failure cases, non-functional needs, dependencies, risks with mitigations, success measures, and rollout considerations.',
  'State relevant business rules, concrete examples, rationale, and next steps when they help a team act on the request. Cover distinct features separately when their rules or acceptance conditions differ.',
  'Discuss UI/UX and architecture only when the supplied request or evidence supports them. Do not invent implementation decisions.',
  'Distinguish confirmed decisions, source-backed statements, assumptions, and open questions. Cite supplied evidence IDs for source-backed claims when applicable.',
  'Natural paraphrasing and synthesis of explicitly related evidence are allowed when the meaning remains supported. Preserve entities, populations, quantities, denominators, units, time periods, conditions, attribution, uncertainty, and causal or normative strength. Cite every supporting passage for a synthesis. A shared document, shared words, or valid citation IDs alone do not establish that facts are compatible. Do not invent entity links, causation, reporting methods, or time relationships. Keep conflicting studies separately attributed; do not merge their metrics. If support is uncertain, flag the point for grounding review rather than asserting it as verified.',
  'Prioritize explicit supplied evidence over generic practice. Preserve stated conditions and limits; when evidence does not answer a point, say so before making a labelled assumption.',
  'Never invent metrics, research, quotations, company policies, stakeholder decisions, or unsupported causal and impact claims.',
  'Ask genuinely blocking clarification questions together. Otherwise produce a useful provisional result with labelled assumptions and open questions; do not repeatedly question the user.',
  'Follow the selected structure in its given order. Respect each section purpose and required status; flag missing information rather than silently replacing a requested template.',
] as const;

const DEFAULT_PURPOSES = new Map(
  DEFAULT_STRUCTURE_SECTIONS.map((section) => [section.title.toLowerCase(), section] as const),
);

export function sectionQualityRequirements(section: PrdSection) {
  const defaultDefinition = DEFAULT_PURPOSES.get(section.title.trim().toLowerCase());
  return {
    id: section.id,
    title: section.title,
    purpose:
      section.purpose?.trim() ||
      defaultDefinition?.purpose ||
      `Provide content directly relevant to the ${section.title} heading.`,
    required: section.required ?? defaultDefinition?.required ?? false,
  };
}

export function workflowForAction(action: AiAction, hasCurrentContent: boolean): string {
  if (action === 'review') return 'Review the current PRD and identify grounded quality gaps.';
  if (action === 'ask') return 'Answer the user question about the current PRD and evidence.';
  if (action === 'rewrite')
    return 'Revise the current PRD while preserving confirmed facts and decisions.';
  return hasCurrentContent
    ? 'Extend or revise the current PRD in response to the user request.'
    : 'Create a new provisional PRD from the user request and supporting material.';
}

export function qualitySystemInstruction(): string {
  return `PRD quality specification ${PRD_QUALITY_SPEC_VERSION}: ${PRD_QUALITY_SPEC.join(' ')}`;
}
