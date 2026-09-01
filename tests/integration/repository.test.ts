import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../../src/server/db/client.js';
import { createDatabase } from '../../src/server/db/client.js';
import { Repository } from '../../src/server/db/repository.js';
import { drainPendingFileDeletions } from '../../src/server/db/file-deletion.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sources, sourceLocations, chunks } from '../../src/server/db/schema.js';
import type { ChatGptHandoffResponse } from '../../src/shared/types.js';
import { config } from '../../src/server/config.js';

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
    const duplicateIds = firstPrd.sections.map((section, index) => ({
      ...section,
      id: index === 1 ? firstPrd.sections[0]!.id : section.id,
    }));
    expect(() => repository.savePrd(first.id, 0, duplicateIds, 'Duplicate IDs')).toThrow(
      'unique ID',
    );
    const positionGap = firstPrd.sections.map((section) => ({
      ...section,
      position: section.position + 1,
    }));
    expect(() => repository.savePrd(first.id, 0, positionGap, 'Position gap')).toThrow(
      'continuous',
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
    expect(() => repository.getLocation(first.id, 'source', 'location')).toThrow('location');
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
      sourceName: 'synthetic.txt',
      locator: 'Paragraph 1',
      excerpt: 'Evidence',
      evidenceStatus: 'supported',
      available: true,
      unavailabilityReason: null,
    });
    const foreignRunId = repository.createAiRun({
      projectId: project.id,
      action: 'review',
      scope: 'document',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
    });
    const foreignCitationId = repository.storeCitation({
      aiRunId: foreignRunId,
      sourceId,
      locationId,
      chunkId,
      sourceName: 'synthetic.txt',
      locator: 'Paragraph 1',
      excerpt: 'Evidence',
      evidenceStatus: 'supported',
      available: true,
      unavailabilityReason: null,
    });
    for (const invalidCitationId of [crypto.randomUUID(), foreignCitationId]) {
      expect(() =>
        repository.storeFinding({
          aiRunId: runId,
          projectId: project.id,
          category: 'evidence',
          severity: 'warning',
          targetSectionId: prd.sections[0]!.id,
          rationale: 'Reject an invalid citation relationship.',
          citationIds: [invalidCitationId],
          proposedPatch: null,
          sourceRevision: 0,
        }),
      ).toThrow('not bound to its source');
      expect(repository.listFindings(project.id)).toEqual([]);
    }
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
    expect(repository.getLocation(project.id, sourceId, locationId).content).toBe('Evidence');
    const foreignProject = repository.createProject('Foreign evidence', '');
    expect(() => repository.getLocation(foreignProject.id, sourceId, locationId)).toThrow(
      'location',
    );

    const revisionOne = repository.savePrd(project.id, 0, prd.sections, 'Close finding revision');
    expect(() => repository.setFindingStatus(project.id, finding.id, 'accepted')).toThrow(
      'no longer open',
    );
    const lateRunId = repository.createAiRun({
      projectId: project.id,
      action: 'review',
      scope: 'document',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: revisionOne.revision,
    });
    repository.savePrd(
      project.id,
      revisionOne.revision,
      revisionOne.sections
        .filter((section) => section.id !== finding.targetSectionId)
        .map((section, position) => ({ ...section, position })),
      'Remove reviewed section',
    );
    const lateFinding = repository.storeFinding({
      aiRunId: lateRunId,
      projectId: project.id,
      category: 'clarity',
      severity: 'info',
      targetSectionId: finding.targetSectionId,
      rationale: 'A review completed after its target was removed.',
      citationIds: [],
      proposedPatch: {
        sectionId: finding.targetSectionId,
        beforeMarkdown: revisionOne.sections[0]!.body,
        afterMarkdown: 'Historical proposal.',
      },
      sourceRevision: revisionOne.revision,
    });
    expect(repository.listFindings(project.id)[0]).toMatchObject({
      id: finding.id,
      targetSectionId: finding.targetSectionId,
      status: 'dismissed',
    });
    expect(repository.listFindings(project.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: lateFinding.id, status: 'stale' })]),
    );
    repository.completeAiRun(lateRunId, undefined, 'Historical review completed.');
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

  it('stages and applies a revision-bound ChatGPT handoff without replay', () => {
    const project = repository.createProject('Handoff', '');
    const initial = repository.getPrd(project.id);
    const problem = initial.sections[0]!;
    const saved = repository.savePrd(
      project.id,
      0,
      initial.sections.map((section) =>
        section.id === problem.id ? { ...section, body: 'Current problem.' } : section,
      ),
      'Seeded problem',
    );
    const handoff = repository.createChatGptHandoff({
      projectId: project.id,
      revision: saved.revision,
      action: 'rewrite',
      scope: 'section',
      instruction: 'Make the problem measurable.',
      sectionIds: [problem.id],
      citationIds: [],
    });
    const response: ChatGptHandoffResponse = {
      formatVersion: 1,
      kind: 'prd-genie-response',
      handoffId: handoff.id,
      projectId: project.id,
      sourceRevision: saved.revision,
      requestDigest: handoff.request.requestDigest,
      summary: 'Clarifies the affected workflow.',
      patches: [
        {
          sectionId: problem.id,
          preimageHash: handoff.request.sections[0]!.preimageHash,
          afterMarkdown: 'Three of five synthetic participants lose draft changes each week.',
          evidenceIds: [],
        },
      ],
      findings: [],
      hostModel: null,
    };
    const staged = repository.importChatGptHandoffResponse(project.id, response);
    expect(staged.status).toBe('staged');
    expect(() => repository.importChatGptHandoffResponse(project.id, response)).toThrow(
      'already has a response',
    );
    const applied = repository.applyChatGptHandoff(project.id, handoff.id, saved.revision, [
      { sectionId: problem.id, afterMarkdown: response.patches[0]!.afterMarkdown },
    ]);
    expect(applied.revision).toBe(saved.revision + 1);
    expect(applied.sections.find((section) => section.id === problem.id)?.body).toContain(
      'synthetic participants',
    );
    const appliedHandoff = repository.getChatGptHandoff(project.id, handoff.id);
    expect(appliedHandoff).toMatchObject({
      status: 'applied',
      appliedRevision: applied.revision,
      application: {
        sourceRevision: saved.revision,
        appliedRevision: applied.revision,
        patches: [
          {
            sectionId: problem.id,
            proposedAfterMarkdown: response.patches[0]!.afterMarkdown,
            appliedAfterMarkdown: response.patches[0]!.afterMarkdown,
          },
        ],
      },
    });
    expect(appliedHandoff.applicationDigest).toBe(
      createHash('sha256').update(JSON.stringify(appliedHandoff.application)).digest('hex'),
    );
    repository.dismissChatGptHandoff(project.id, handoff.id);
    expect(repository.listChatGptHandoffs(project.id)).toEqual([]);
    expect(() => repository.getChatGptHandoff(project.id, handoff.id)).toThrow('not found');
    const retained = database.sqlite
      .prepare(
        'SELECT status, request_json AS requestJson, response_json AS responseJson, application_json AS applicationJson, retired_at AS retiredAt FROM chatgpt_handoffs WHERE id = ?',
      )
      .get(handoff.id) as {
      status: string;
      requestJson: string;
      responseJson: string;
      applicationJson: string;
      retiredAt: string;
    };
    expect(retained.status).toBe('applied');
    expect(retained.requestJson.length).toBeGreaterThan(0);
    expect(retained.responseJson.length).toBeGreaterThan(0);
    expect(retained.applicationJson.length).toBeGreaterThan(0);
    expect(retained.retiredAt.length).toBeGreaterThan(0);
  });

  it('rolls back the PRD revision when the ChatGPT application marker fails', () => {
    const project = repository.createProject('Atomic handoff', '');
    const current = repository.getPrd(project.id);
    const problem = current.sections[0]!;
    const handoff = repository.createChatGptHandoff({
      projectId: project.id,
      revision: current.revision,
      action: 'rewrite',
      scope: 'section',
      instruction: 'Clarify the problem.',
      sectionIds: [problem.id],
      citationIds: [],
    });
    const response: ChatGptHandoffResponse = {
      formatVersion: 1,
      kind: 'prd-genie-response',
      handoffId: handoff.id,
      projectId: project.id,
      sourceRevision: current.revision,
      requestDigest: handoff.request.requestDigest,
      summary: 'Clarifies the synthetic problem.',
      patches: [
        {
          sectionId: problem.id,
          preimageHash: handoff.request.sections[0]!.preimageHash,
          afterMarkdown: 'Atomic replacement.',
          evidenceIds: [],
        },
      ],
      findings: [],
      hostModel: null,
    };
    repository.importChatGptHandoffResponse(project.id, response);
    database.sqlite.exec(`
      CREATE TEMP TRIGGER fail_handoff_application_marker
      BEFORE UPDATE OF status, applied_revision ON chatgpt_handoffs
      WHEN NEW.id = '${handoff.id}' AND NEW.status = 'applied'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic handoff marker failure');
      END
    `);

    expect(() =>
      repository.applyChatGptHandoff(project.id, handoff.id, current.revision, [
        { sectionId: problem.id, afterMarkdown: 'Atomic replacement.' },
      ]),
    ).toThrow('synthetic handoff marker failure');
    expect(repository.getPrd(project.id)).toMatchObject({ revision: current.revision });
    expect(repository.getPrd(project.id).sections[0]?.body).toBe(problem.body);
    expect(repository.listRevisions(project.id)).toHaveLength(1);
    expect(repository.getChatGptHandoff(project.id, handoff.id)).toMatchObject({
      status: 'staged',
      appliedRevision: null,
      application: null,
      applicationDigest: null,
    });
  });

  it('rolls back review finding status when revision creation fails and retries once', () => {
    const project = repository.createProject('Atomic review finding', '');
    const current = repository.getPrd(project.id);
    const target = current.sections[0]!;
    const runId = repository.createAiRun({
      projectId: project.id,
      action: 'review',
      scope: 'document',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: current.revision,
    });
    const finding = repository.storeFinding({
      aiRunId: runId,
      projectId: project.id,
      category: 'clarity',
      severity: 'warning',
      targetSectionId: target.id,
      rationale: 'Clarify the actor.',
      citationIds: [],
      proposedPatch: {
        sectionId: target.id,
        beforeMarkdown: target.body,
        afterMarkdown: 'A product manager loses unsaved draft changes.',
      },
      sourceRevision: current.revision,
    });
    database.sqlite.exec(`
      CREATE TEMP TRIGGER fail_review_revision_insert
      BEFORE INSERT ON revisions
      WHEN NEW.project_id = '${project.id}' AND NEW.revision = 1
      BEGIN
        SELECT RAISE(ABORT, 'synthetic review revision failure');
      END
    `);

    expect(() => repository.acceptFinding(project.id, finding.id, current.revision)).toThrow(
      'synthetic review revision failure',
    );
    expect(repository.getPrd(project.id)).toMatchObject({ revision: current.revision });
    expect(repository.getPrd(project.id).sections[0]?.body).toBe(target.body);
    expect(repository.listRevisions(project.id)).toHaveLength(1);
    expect(repository.listFindings(project.id)[0]?.status).toBe('open');

    database.sqlite.exec('DROP TRIGGER fail_review_revision_insert');
    const applied = repository.acceptFinding(project.id, finding.id, current.revision);
    expect(applied.revision).toBe(1);
    expect(repository.listRevisions(project.id)).toHaveLength(2);
    expect(repository.listFindings(project.id)[0]?.status).toBe('accepted');
  });

  it('marks an outstanding ChatGPT handoff stale when the PRD changes', () => {
    const project = repository.createProject('Stale handoff', '');
    const initial = repository.getPrd(project.id);
    const problem = initial.sections[0]!;
    const handoff = repository.createChatGptHandoff({
      projectId: project.id,
      revision: initial.revision,
      action: 'rewrite',
      scope: 'section',
      instruction: 'Clarify the problem.',
      sectionIds: [problem.id],
      citationIds: [],
    });
    repository.savePrd(
      project.id,
      initial.revision,
      initial.sections.map((section) =>
        section.id === problem.id ? { ...section, body: 'A later local edit.' } : section,
      ),
      'Later edit',
    );
    expect(repository.getChatGptHandoff(project.id, handoff.id).status).toBe('stale');
  });

  it('retains citation snapshots after deleting their local source', () => {
    const project = repository.createProject('Evidence lifecycle', '');
    const sourceId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    const chunkId = crypto.randomUUID();
    database.db
      .insert(sources)
      .values({
        id: sourceId,
        projectId: project.id,
        name: 'deleted-source.txt',
        mediaType: 'text/plain',
        size: 8,
        hash: 'c'.repeat(64),
        binaryPath: path.join(os.tmpdir(), `missing-${sourceId}.txt`),
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
        documentHash: 'c'.repeat(64),
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
      sourceName: 'deleted-source.txt',
      locator: 'Paragraph 1',
      excerpt: 'Evidence',
      evidenceStatus: 'supported',
      available: true,
      unavailabilityReason: null,
    });
    repository.completeAiRun(runId, undefined, 'Historical answer');
    const exportedHandoff = repository.createChatGptHandoff({
      projectId: project.id,
      revision: 0,
      action: 'rewrite',
      scope: 'section',
      instruction: 'Use the current evidence.',
      sectionIds: [repository.getPrd(project.id).sections[0]!.id],
      citationIds: [citationId],
    });
    const stagedHandoff = repository.createChatGptHandoff({
      projectId: project.id,
      revision: 0,
      action: 'review',
      scope: 'document',
      instruction: 'Review using the current evidence.',
      sectionIds: repository.getPrd(project.id).sections.map((section) => section.id),
      citationIds: [citationId],
    });
    repository.importChatGptHandoffResponse(project.id, {
      formatVersion: 1,
      kind: 'prd-genie-response',
      handoffId: stagedHandoff.id,
      projectId: project.id,
      sourceRevision: 0,
      requestDigest: stagedHandoff.request.requestDigest,
      summary: 'Synthetic evidence-backed review.',
      patches: [],
      findings: [],
      hostModel: null,
    });
    const openFinding = repository.storeFinding({
      aiRunId: runId,
      projectId: project.id,
      category: 'evidence',
      severity: 'warning',
      targetSectionId: repository.getPrd(project.id).sections[0]!.id,
      rationale: 'This review initially has available evidence.',
      citationIds: [citationId],
      proposedPatch: {
        sectionId: repository.getPrd(project.id).sections[0]!.id,
        beforeMarkdown: repository.getPrd(project.id).sections[0]!.body,
        afterMarkdown: 'Evidence-backed proposal.',
      },
      sourceRevision: 0,
    });
    expect(openFinding.status).toBe('open');
    repository.deleteSource(project.id, sourceId);
    expect(repository.getChatGptHandoff(project.id, exportedHandoff.id).status).toBe('stale');
    expect(repository.getChatGptHandoff(project.id, stagedHandoff.id).status).toBe('stale');
    expect(repository.listAiRuns(project.id)[0]?.citations[0]).toMatchObject({
      sourceId: null,
      locationId: null,
      chunkId: null,
      sourceName: 'deleted-source.txt',
      excerpt: 'Evidence',
      available: false,
      unavailabilityReason: 'source_deleted',
    });
    expect(repository.listFindings(project.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: openFinding.id, status: 'stale' })]),
    );
    database.sqlite
      .prepare("UPDATE review_findings SET status = 'open' WHERE id = ?")
      .run(openFinding.id);
    expect(() => repository.acceptFinding(project.id, openFinding.id, 0)).toThrow(
      'evidence that is no longer available',
    );
    expect(repository.listFindings(project.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: openFinding.id, status: 'stale' })]),
    );
    const delayedFinding = repository.storeFinding({
      aiRunId: runId,
      projectId: project.id,
      category: 'evidence',
      severity: 'warning',
      targetSectionId: repository.getPrd(project.id).sections[0]!.id,
      rationale: 'This review completed after its source was deleted.',
      citationIds: [citationId],
      proposedPatch: {
        sectionId: repository.getPrd(project.id).sections[0]!.id,
        beforeMarkdown: repository.getPrd(project.id).sections[0]!.body,
        afterMarkdown: 'Do not accept a proposal whose evidence was deleted.',
      },
      sourceRevision: 0,
    });
    expect(delayedFinding.status).toBe('stale');
    expect(() => repository.acceptFinding(project.id, delayedFinding.id, 0)).toThrow(
      'older PRD revision',
    );
    expect(() =>
      repository.createChatGptHandoff({
        projectId: project.id,
        revision: repository.getPrd(project.id).revision,
        action: 'rewrite',
        scope: 'document',
        instruction: 'Review only available evidence.',
        sectionIds: repository.getPrd(project.id).sections.map((section) => section.id),
        citationIds: [citationId],
      }),
    ).toThrow('no longer available');
  });

  it('retains unexpected filesystem cleanup failures for deterministic retry', () => {
    const project = repository.createProject('Filesystem failure', '');
    const sourceId = crypto.randomUUID();
    const sourceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-delete-error-'));
    const binaryPath = path.join(sourceDirectory, 'unexpected-directory');
    const originalSourceDir = config.sourceDir;
    Object.assign(config, { sourceDir: sourceDirectory });
    fs.mkdirSync(binaryPath);
    database.db
      .insert(sources)
      .values({
        id: sourceId,
        projectId: project.id,
        name: 'directory.txt',
        mediaType: 'text/plain',
        size: 0,
        hash: 'd'.repeat(64),
        binaryPath,
        status: 'ready',
        error: null,
        createdAt: new Date().toISOString(),
      })
      .run();
    try {
      repository.deleteSource(project.id, sourceId);
      expect(repository.listSources(project.id)).toHaveLength(0);
      expect(database.sqlite.prepare('SELECT attempts FROM pending_file_deletions').get()).toEqual({
        attempts: 1,
      });
      fs.rmSync(binaryPath, { recursive: true, force: true });
      expect(drainPendingFileDeletions(database)).toBe(0);
    } finally {
      Object.assign(config, { sourceDir: originalSourceDir });
      fs.rmSync(sourceDirectory, { recursive: true, force: true });
    }
  });
});
