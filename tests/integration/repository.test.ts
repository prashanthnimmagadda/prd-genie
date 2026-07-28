import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../../src/server/db/client.js';
import { createDatabase } from '../../src/server/db/client.js';
import { Repository } from '../../src/server/db/repository.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sources, sourceLocations, chunks } from '../../src/server/db/schema.js';

describe('Repository', () => {
  let database: AppDatabase;
  let repository: Repository;

  beforeEach(() => {
    database = createDatabase(':memory:');
    repository = new Repository(database);
  });

  afterEach(() => database.close());

  it('creates a revisioned project with the default section contract', () => {
    const project = repository.createProject('Checkout', 'Reduce payment friction');
    const prd = repository.getPrd(project.id);
    expect(prd.revision).toBe(0);
    expect(prd.sections).toHaveLength(13);
    expect(prd.sections[0]?.title).toBe('Problem');
    expect(repository.listProjects()[0]?.id).toBe(project.id);
  });

  it('saves, reorders, extends, and rejects stale revisions', () => {
    const project = repository.createProject('Checkout', '');
    const prd = repository.getPrd(project.id);
    const newSection = {
      id: crypto.randomUUID(),
      projectId: project.id,
      title: 'Decision log',
      body: 'Decision one',
      position: 0,
      updatedAt: new Date().toISOString(),
    };
    const sections = [
      newSection,
      ...prd.sections.map((section, index) => ({ ...section, position: index + 1 })),
    ];
    const saved = repository.savePrd(project.id, 0, sections, 'Added decision log');
    expect(saved.revision).toBe(1);
    expect(saved.sections[0]?.title).toBe('Decision log');
    expect(() => repository.savePrd(project.id, 0, sections, 'Stale')).toThrow('changed since');
  });

  it('updates project model preferences without storing credentials', () => {
    const project = repository.createProject('Checkout', '');
    const updated = repository.updateProject(project.id, {
      selectedProvider: 'anthropic',
      selectedModel: 'test-model',
    });
    expect(updated.selectedProvider).toBe('anthropic');
    expect(updated.selectedModel).toBe('test-model');
    expect(JSON.stringify(updated)).not.toContain('apiKey');
  });

  it('validates project, section, finding, and location identities', () => {
    const first = repository.createProject('First', '');
    const second = repository.createProject('Second', '');
    expect(() => repository.getProject('missing')).toThrow('Project not found');

    const firstPrd = repository.getPrd(first.id);
    const duplicatePositions = firstPrd.sections.map((section) => ({ ...section, position: 0 }));
    expect(() => repository.savePrd(first.id, 0, duplicatePositions, 'Invalid')).toThrow(
      'unique position',
    );
    const foreignId = repository.getPrd(second.id).sections[0]?.id;
    expect(foreignId).toBeTruthy();
    expect(() =>
      repository.savePrd(
        first.id,
        0,
        firstPrd.sections.map((section, index) => ({
          ...section,
          id: index === 0 ? (foreignId as string) : section.id,
        })),
        'Collision',
      ),
    ).toThrow('already in use');
    expect(() => repository.getLocation('source', 'location')).toThrow('location');
    expect(() => repository.setFindingStatus(first.id, 'missing', 'accepted')).toThrow('finding');
    expect(repository.listRevisions(first.id)).toHaveLength(1);
    expect(repository.listSources(first.id)).toEqual([]);
  });

  it('records AI runs, citations, findings, status changes, and stale review state', () => {
    const project = repository.createProject('Review', '');
    const prd = repository.getPrd(project.id);
    const sourceId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    const chunkId = crypto.randomUUID();
    database.db
      .insert(sources)
      .values({
        id: sourceId,
        projectId: project.id,
        name: 'synthetic.txt',
        mediaType: 'text/plain',
        size: 9,
        hash: 'a'.repeat(64),
        binaryPath: path.join(os.tmpdir(), 'missing-synthetic-source'),
        status: 'ready',
        error: null,
        createdAt: new Date().toISOString(),
      })
      .run();
    database.db
      .insert(sourceLocations)
      .values({
        id: locationId,
        sourceId,
        locator: 'Paragraph 1',
        heading: null,
        ordinal: 0,
        content: 'Evidence',
        startOffset: 0,
        endOffset: 8,
      })
      .run();
    database.db
      .insert(chunks)
      .values({
        id: chunkId,
        projectId: project.id,
        sourceId,
        locationId,
        ordinal: 0,
        content: 'Evidence',
        tokenCount: 2,
        startOffset: 0,
        endOffset: 8,
        documentHash: 'a'.repeat(64),
      })
      .run();
    const runId = repository.createAiRun({
      projectId: project.id,
      action: 'review',
      scope: 'document',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
    });
    const citationId = repository.storeCitation({
      aiRunId: runId,
      sourceId,
      locationId,
      chunkId,
      excerpt: 'Evidence',
      evidenceStatus: 'supported',
    });
    const finding = repository.storeFinding({
      aiRunId: runId,
      projectId: project.id,
      category: 'evidence',
      severity: 'warning',
      targetSectionId: prd.sections[0]!.id,
      rationale: 'Add a source.',
      citationIds: [citationId],
      proposedPatch: {
        sectionId: prd.sections[0]!.id,
        beforeMarkdown: '',
        afterMarkdown: 'Supported statement.',
      },
      sourceRevision: 0,
    });
    repository.completeAiRun(runId);
    expect(repository.listFindings(project.id)[0]).toMatchObject({
      id: finding.id,
      status: 'open',
      proposedPatch: { afterMarkdown: 'Supported statement.' },
    });
    expect(repository.listFindings(project.id)[0]?.citations).toEqual([
      expect.objectContaining({
        id: citationId,
        sourceName: 'synthetic.txt',
        locator: 'Paragraph 1',
        excerpt: 'Evidence',
      }),
    ]);
    repository.setFindingStatus(project.id, finding.id, 'dismissed');
    expect(repository.listFindings(project.id)[0]?.status).toBe('dismissed');
    expect(repository.getLocation(sourceId, locationId).content).toBe('Evidence');

    repository.savePrd(project.id, 0, prd.sections, 'Make findings stale');
    expect(() => repository.setFindingStatus(project.id, finding.id, 'accepted')).toThrow(
      'no longer open',
    );
    repository.completeAiRun(runId, 'provider_unavailable');
  });

  it('deletes a complete project and tolerates an already absent source binary', () => {
    const project = repository.createProject('Disposable', '');
    const absent = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-delete-')),
      'already-gone.txt',
    );
    database.db
      .insert(sources)
      .values({
        id: crypto.randomUUID(),
        projectId: project.id,
        name: 'already-gone.txt',
        mediaType: 'text/plain',
        size: 1,
        hash: 'b'.repeat(64),
        binaryPath: absent,
        status: 'ready',
        error: null,
        createdAt: new Date().toISOString(),
      })
      .run();
    repository.deleteProject(project.id);
    expect(repository.listProjects()).toEqual([]);
  });
});
