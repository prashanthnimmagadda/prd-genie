// Zod-free so the client bundle can import it without pulling in schema code.
export interface StructureSection {
  title: string;
  purpose: string;
  required: boolean;
}

export const DEFAULT_STRUCTURE_SECTIONS: readonly StructureSection[] = [
  {
    title: 'Problem',
    purpose: 'Describe the specific user or business problem and why it matters now.',
    required: true,
  },
  {
    title: 'Context',
    purpose:
      'Record confirmed background, source evidence, constraints and relevant prior decisions.',
    required: true,
  },
  {
    title: 'Target users',
    purpose: 'Identify intended users and their distinct needs without inventing research.',
    required: true,
  },
  { title: 'Goals', purpose: 'State the outcomes this work aims to achieve.', required: true },
  {
    title: 'Non-goals',
    purpose: 'Make relevant exclusions and boundaries explicit.',
    required: false,
  },
  {
    title: 'Scope',
    purpose: 'Define what is included in this version and what remains outside it.',
    required: true,
  },
  {
    title: 'User journeys',
    purpose: 'Describe primary flows and relevant edge or failure paths.',
    required: true,
  },
  {
    title: 'Requirements and acceptance criteria',
    purpose: 'Specify actionable behavior and testable conditions for acceptance.',
    required: true,
  },
  {
    title: 'Success measures',
    purpose: 'Name measurable signals and measurement approach without fabricating targets.',
    required: false,
  },
  {
    title: 'Dependencies',
    purpose: 'Record external systems, decisions or teams needed to deliver the scope.',
    required: false,
  },
  {
    title: 'Risks',
    purpose: 'Describe material risks, their impact and proportionate mitigations.',
    required: false,
  },
  {
    title: 'Open questions',
    purpose: 'List unresolved decisions and label assumptions separately from confirmed facts.',
    required: false,
  },
  {
    title: 'Rollout',
    purpose: 'Explain release, migration or communication steps when relevant.',
    required: false,
  },
];
