import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../../src/server/db/client.js';
import { createDatabase } from '../../src/server/db/client.js';
import { Repository } from '../../src/server/db/repository.js';
import {
  parseDocumentProposal,
  ProposalService,
} from '../../src/server/providers/proposal-service.js';

describe('ProposalService', () => {
  let database: AppDatabase;
  let repository: Repository;
  let proposals: ProposalService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    repository = new Repository(database);
    proposals = new ProposalService(repository);
  });

  afterEach(() => database.close());

  it('applies a section proposal once and restores the source revision', () => {
    const project = repository.createProject('Recovery', '');
    const prd = repository.getPrd(project.id);
    const section = prd.sections[0]!;
    const runId = repository.createAiRun({
      projectId: project.id,
      action: 'rewrite',
      scope: 'section',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
      targetSectionId: section.id,
    });
    repository.completeAiRun(runId, undefined, '## Problem\n\nA measurable recovery problem.');
    const applied = proposals.apply(project.id, runId, 0);
    expect(applied.revision).toBe(1);
    expect(applied.sections[0]?.body).toBe('A measurable recovery problem.');
    expect(repository.getAiRun(project.id, runId).appliedRevision).toBe(1);
    expect(() => proposals.apply(project.id, runId, 1)).toThrow('already applied');

    const restored = repository.restoreRevision(project.id, 0, 1);
    expect(restored.revision).toBe(2);
    expect(restored.sections[0]?.body).toBe('');
  });

  it('replaces only a unique selected span and rejects changed selections', () => {
    const project = repository.createProject('Selection', '');
    const initial = repository.getPrd(project.id);
    const section = initial.sections[0]!;
    const seeded = repository.savePrd(
      project.id,
      0,
      initial.sections.map((item) =>
        item.id === section.id ? { ...item, body: 'Drafts are sometimes lost.' } : item,
      ),
      'Seed selection',
    );
    const runId = repository.createAiRun({
      projectId: project.id,
      action: 'rewrite',
      scope: 'selection',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: seeded.revision,
      targetSectionId: section.id,
      selectionText: 'sometimes',
    });
    repository.completeAiRun(runId, undefined, 'frequently');
    const applied = proposals.apply(project.id, runId, seeded.revision);
    expect(applied.sections[0]?.body).toBe('Drafts are frequently lost.');
  });

  it('requires every stable section marker in a document proposal', () => {
    const project = repository.createProject('Document', '');
    const sections = repository.getPrd(project.id).sections.slice(0, 2);
    const output = sections
      .map(
        (section) =>
          `<!-- section:${section.id} -->\n## ${section.title}\nBody ${section.position}`,
      )
      .join('\n\n');
    expect(parseDocumentProposal(output, sections).map((section) => section.body)).toEqual([
      'Body 0',
      'Body 1',
    ]);
    expect(() => parseDocumentProposal(output.split('\n\n')[0] ?? '', sections)).toThrow(
      'every current section',
    );
    expect(() => parseDocumentProposal(`${output}\n\n${output}`, sections)).toThrow(
      'invalid sections',
    );
  });

  it('rejects incomplete, non-applicable, stale, empty, and missing-target proposals', () => {
    const project = repository.createProject('Rejections', '');
    const section = repository.getPrd(project.id).sections[0]!;
    const incomplete = repository.createAiRun({
      projectId: project.id,
      action: 'rewrite',
      scope: 'section',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
      targetSectionId: section.id,
    });
    expect(() => proposals.apply(project.id, incomplete, 0)).toThrow('not complete');

    const ask = repository.createAiRun({
      projectId: project.id,
      action: 'ask',
      scope: 'section',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
      targetSectionId: section.id,
    });
    repository.completeAiRun(ask, undefined, 'Answer');
    expect(() => proposals.apply(project.id, ask, 0)).toThrow('cannot change');

    const stale = repository.createAiRun({
      projectId: project.id,
      action: 'rewrite',
      scope: 'section',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 1,
      targetSectionId: section.id,
    });
    repository.completeAiRun(stale, undefined, 'Updated');
    expect(() => proposals.apply(project.id, stale, 0)).toThrow('older PRD revision');

    const empty = repository.createAiRun({
      projectId: project.id,
      action: 'rewrite',
      scope: 'section',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
      targetSectionId: section.id,
    });
    repository.completeAiRun(empty, undefined, 'Stored output');
    expect(() => proposals.apply(project.id, empty, 0, ' ')).toThrow('empty');

    const missing = repository.createAiRun({
      projectId: project.id,
      action: 'rewrite',
      scope: 'section',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
      targetSectionId: crypto.randomUUID(),
    });
    repository.completeAiRun(missing, undefined, 'Updated');
    expect(() => proposals.apply(project.id, missing, 0)).toThrow('target no longer exists');
  });

  it('rejects duplicate selections and headings for another section', () => {
    const project = repository.createProject('Malformed', '');
    const initial = repository.getPrd(project.id);
    const section = initial.sections[0]!;
    repository.savePrd(
      project.id,
      0,
      initial.sections.map((item) =>
        item.id === section.id ? { ...item, body: 'lost and lost' } : item,
      ),
      'Seed duplicate selection',
    );
    const duplicate = repository.createAiRun({
      projectId: project.id,
      action: 'rewrite',
      scope: 'selection',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 1,
      targetSectionId: section.id,
      selectionText: 'lost',
    });
    repository.completeAiRun(duplicate, undefined, 'recovered');
    expect(() => proposals.apply(project.id, duplicate, 1)).toThrow('no longer unique');

    const wrongHeading = repository.createAiRun({
      projectId: project.id,
      action: 'rewrite',
      scope: 'section',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 1,
      targetSectionId: section.id,
    });
    repository.completeAiRun(wrongHeading, undefined, '## Goals\nWrong section');
    expect(() => proposals.apply(project.id, wrongHeading, 1)).toThrow('different section');
  });

  it('accepts a heading that names one half of a compound target title', () => {
    const project = repository.createProject('Compound heading', '');
    const initial = repository.getPrd(project.id);
    const section = initial.sections.find(
      (item) => item.title === 'Requirements and acceptance criteria',
    )!;
    const run = repository.createAiRun({
      projectId: project.id,
      action: 'rewrite',
      scope: 'section',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
      targetSectionId: section.id,
    });
    repository.completeAiRun(run, undefined, '## Requirements\nThe editor must save drafts.');
    const applied = proposals.apply(project.id, run, 0);
    expect(applied.sections.find((item) => item.id === section.id)?.body).toBe(
      'The editor must save drafts.',
    );
  });
});
