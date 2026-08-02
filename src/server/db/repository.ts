import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type {
  AiRunProposal,
  ChatGptHandoffRequest,
  ChatGptHandoffResponse,
  ChatGptHandoffSummary,
  Citation,
  PrdDocument,
  PrdSection,
  ProjectSummary,
  ReviewFinding,
  SourceSummary,
} from '../../shared/types.js';
import { DEFAULT_SECTIONS } from '../../shared/types.js';
import { ApiError } from '../../shared/api.js';
import type { AppDatabase } from './client.js';
import {
  aiRuns,
  chatGptHandoffs,
  citations,
  prdDocuments,
  prdSections,
  projects,
  reviewFindings,
  revisions,
  sourceLocations,
  sources,
} from './schema.js';
import { deleteSourceData } from './source-deletion.js';

function now(): string {
  return new Date().toISOString();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export class Repository {
  constructor(readonly database: AppDatabase) {}

  listProjects(): ProjectSummary[] {
    return this.database.db
      .select()
      .from(projects)
      .orderBy(projects.updatedAt)
      .all()
      .reverse() as ProjectSummary[];
  }

  getProject(id: string): ProjectSummary {
    const project = this.database.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!project) throw new ApiError(404, 'project_not_found', 'Project not found.');
    return project as ProjectSummary;
  }

  createProject(name: string, description: string): ProjectSummary {
    const timestamp = now();
    const project: ProjectSummary = {
      id: crypto.randomUUID(),
      name,
      description,
      selectedProvider: null,
      selectedModel: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const sections: PrdSection[] = DEFAULT_SECTIONS.map((title, position) => ({
      id: crypto.randomUUID(),
      projectId: project.id,
      title,
      body: '',
      position,
      updatedAt: timestamp,
    }));
    this.database.sqlite.transaction(() => {
      this.database.db.insert(projects).values(project).run();
      this.database.db
        .insert(prdDocuments)
        .values({ projectId: project.id, revision: 0, updatedAt: timestamp })
        .run();
      this.database.db.insert(prdSections).values(sections).run();
      this.database.db
        .insert(revisions)
        .values({
          id: crypto.randomUUID(),
          projectId: project.id,
          revision: 0,
          reason: 'Project created',
          snapshotJson: JSON.stringify(sections),
          createdAt: timestamp,
        })
        .run();
    })();
    return project;
  }

  updateProject(
    id: string,
    updates: {
      name?: string;
      description?: string;
      selectedProvider?: ProjectSummary['selectedProvider'];
      selectedModel?: string | null;
    },
  ): ProjectSummary {
    this.getProject(id);
    this.database.db
      .update(projects)
      .set({ ...updates, updatedAt: now() })
      .where(eq(projects.id, id))
      .run();
    return this.getProject(id);
  }

  deleteProject(id: string): void {
    this.getProject(id);
    const vectorIds = this.database.sqlite
      .prepare('SELECT id FROM chunks WHERE project_id = ?')
      .all(id) as Array<{ id: string }>;
    const binaries = this.database.db
      .select({ binaryPath: sources.binaryPath })
      .from(sources)
      .where(eq(sources.projectId, id))
      .all();
    this.database.sqlite.transaction(() => {
      if (this.database.vectorAvailable) {
        const deleteVector = this.database.sqlite.prepare(
          'DELETE FROM chunk_vectors WHERE chunk_id = ?',
        );
        for (const row of vectorIds) deleteVector.run(row.id);
      }
      this.database.sqlite.prepare('DELETE FROM chunks_fts WHERE project_id = ?').run(id);
      this.database.db.delete(projects).where(eq(projects.id, id)).run();
    })();
    for (const { binaryPath } of binaries) {
      const remaining = this.database.sqlite
        .prepare('SELECT count(*) AS count FROM sources WHERE binary_path = ?')
        .get(binaryPath) as { count: number };
      if (remaining.count > 0) continue;
      try {
        fs.unlinkSync(binaryPath);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
  }

  getPrd(projectId: string): PrdDocument {
    this.getProject(projectId);
    const document = this.database.db
      .select()
      .from(prdDocuments)
      .where(eq(prdDocuments.projectId, projectId))
      .get();
    const sections = this.database.db
      .select()
      .from(prdSections)
      .where(eq(prdSections.projectId, projectId))
      .orderBy(prdSections.position)
      .all();
    return { projectId, revision: document?.revision ?? 0, sections };
  }

  savePrd(
    projectId: string,
    expectedRevision: number,
    updatedSections: Array<Pick<PrdSection, 'id' | 'title' | 'body' | 'position'>>,
    reason: string,
  ): PrdDocument {
    const current = this.getPrd(projectId);
    if (current.revision !== expectedRevision) {
      throw new ApiError(
        409,
        'stale_revision',
        'The PRD changed since this edit began. Refresh before applying it.',
      );
    }
    const existingIds = new Set(current.sections.map((section) => section.id));
    for (const section of updatedSections) {
      if (existingIds.has(section.id)) continue;
      const collision = this.database.sqlite
        .prepare('SELECT project_id AS projectId FROM prd_sections WHERE id = ?')
        .get(section.id) as { projectId: string } | undefined;
      if (collision) {
        throw new ApiError(400, 'invalid_section', 'A section ID is already in use.');
      }
    }
    const positions = new Set(updatedSections.map((section) => section.position));
    if (positions.size !== updatedSections.length) {
      throw new ApiError(400, 'duplicate_position', 'Each section needs a unique position.');
    }
    const timestamp = now();
    const nextRevision = expectedRevision + 1;
    const snapshot = updatedSections
      .sort((left, right) => left.position - right.position)
      .map((section) => ({ ...section, projectId, updatedAt: timestamp }));
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare('UPDATE prd_sections SET position = -position - 1 WHERE project_id = ?')
        .run(projectId);
      const upsertSection = this.database.sqlite.prepare(`
        INSERT INTO prd_sections (id, project_id, title, body, position, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          body = excluded.body,
          position = excluded.position,
          updated_at = excluded.updated_at
      `);
      for (const section of snapshot) {
        upsertSection.run(
          section.id,
          section.projectId,
          section.title,
          section.body,
          section.position,
          section.updatedAt,
        );
      }
      const retainedIds = new Set(snapshot.map((section) => section.id));
      const deleteSection = this.database.sqlite.prepare(
        'DELETE FROM prd_sections WHERE id = ? AND project_id = ?',
      );
      for (const section of current.sections) {
        if (!retainedIds.has(section.id)) deleteSection.run(section.id, projectId);
      }
      this.database.db
        .update(prdDocuments)
        .set({ revision: nextRevision, updatedAt: timestamp })
        .where(eq(prdDocuments.projectId, projectId))
        .run();
      this.database.db
        .insert(revisions)
        .values({
          id: crypto.randomUUID(),
          projectId,
          revision: nextRevision,
          reason,
          snapshotJson: JSON.stringify(snapshot),
          createdAt: timestamp,
        })
        .run();
      this.database.sqlite
        .prepare(
          "UPDATE review_findings SET status = 'stale' WHERE project_id = ? AND status = 'open'",
        )
        .run(projectId);
      this.database.sqlite
        .prepare(
          "UPDATE chatgpt_handoffs SET status = 'stale' WHERE project_id = ? AND status IN ('exported', 'staged')",
        )
        .run(projectId);
      this.database.db
        .update(projects)
        .set({ updatedAt: timestamp })
        .where(eq(projects.id, projectId))
        .run();
    })();
    return this.getPrd(projectId);
  }

  listRevisions(projectId: string) {
    this.getProject(projectId);
    return this.database.db
      .select({
        id: revisions.id,
        revision: revisions.revision,
        reason: revisions.reason,
        createdAt: revisions.createdAt,
      })
      .from(revisions)
      .where(eq(revisions.projectId, projectId))
      .orderBy(revisions.revision)
      .all()
      .reverse();
  }

  listSources(projectId: string): SourceSummary[] {
    this.getProject(projectId);
    return this.database.db
      .select({
        id: sources.id,
        projectId: sources.projectId,
        name: sources.name,
        mediaType: sources.mediaType,
        size: sources.size,
        hash: sources.hash,
        status: sources.status,
        error: sources.error,
        createdAt: sources.createdAt,
      })
      .from(sources)
      .where(eq(sources.projectId, projectId))
      .all() as SourceSummary[];
  }

  deleteSource(projectId: string, sourceId: string): void {
    deleteSourceData(this.database, projectId, sourceId);
  }

  createAiRun(input: {
    projectId: string;
    action: string;
    scope: string;
    provider: string;
    model: string;
    sourceRevision: number;
    targetSectionId?: string;
    selectionText?: string;
  }): string {
    const id = crypto.randomUUID();
    this.database.db
      .insert(aiRuns)
      .values({ id, ...input, status: 'running', startedAt: now() })
      .run();
    return id;
  }

  completeAiRun(id: string, errorCode?: string, outputText?: string): void {
    this.database.db
      .update(aiRuns)
      .set({
        status: errorCode ? 'failed' : 'completed',
        errorCode: errorCode ?? null,
        outputText: outputText ?? null,
        completedAt: now(),
      })
      .where(eq(aiRuns.id, id))
      .run();
  }

  getAiRun(projectId: string, id: string): AiRunProposal {
    const row = this.database.db.select().from(aiRuns).where(eq(aiRuns.id, id)).get();
    if (!row || row.projectId !== projectId) {
      throw new ApiError(404, 'ai_run_not_found', 'AI proposal not found.');
    }
    return {
      id: row.id,
      projectId: row.projectId,
      action: row.action as AiRunProposal['action'],
      scope: row.scope as AiRunProposal['scope'],
      provider: row.provider as AiRunProposal['provider'],
      model: row.model,
      sourceRevision: row.sourceRevision,
      targetSectionId: row.targetSectionId,
      selectionText: row.selectionText,
      outputText: row.outputText,
      appliedRevision: row.appliedRevision,
      status: row.status as AiRunProposal['status'],
      errorCode: row.errorCode,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      citations: this.listCitationsForRun(row.id),
    };
  }

  listAiRuns(projectId: string): AiRunProposal[] {
    this.getProject(projectId);
    const rows = this.database.db
      .select({ id: aiRuns.id })
      .from(aiRuns)
      .where(eq(aiRuns.projectId, projectId))
      .orderBy(aiRuns.startedAt)
      .all()
      .reverse();
    return rows.map((row) => this.getAiRun(projectId, row.id));
  }

  createChatGptHandoff(input: {
    projectId: string;
    revision: number;
    action: ChatGptHandoffRequest['action'];
    scope: ChatGptHandoffRequest['scope'];
    instruction: string;
    sectionIds: string[];
    citationIds: string[];
  }): ChatGptHandoffSummary {
    const prd = this.getPrd(input.projectId);
    if (prd.revision !== input.revision) {
      throw new ApiError(409, 'stale_revision', 'The PRD changed before this handoff was created.');
    }
    const uniqueSectionIds = [...new Set(input.sectionIds)];
    if (uniqueSectionIds.length !== input.sectionIds.length) {
      throw new ApiError(400, 'duplicate_section', 'Each handoff section must be unique.');
    }
    const sectionById = new Map(prd.sections.map((section) => [section.id, section]));
    const sections = uniqueSectionIds.map((id) => {
      const section = sectionById.get(id);
      if (!section) throw new ApiError(400, 'invalid_section', 'A handoff section is invalid.');
      return {
        id: section.id,
        title: section.title,
        markdown: section.body,
        preimageHash: sha256(section.body),
      };
    });
    const evidenceLookup = this.database.sqlite.prepare(
      `SELECT citations.id, citations.source_name AS sourceName,
              citations.locator, citations.excerpt, citations.available,
              citations.unavailability_reason AS unavailabilityReason
       FROM citations
       JOIN ai_runs ON ai_runs.id = citations.ai_run_id
       WHERE citations.id = ? AND ai_runs.project_id = ?`,
    );
    const uniqueCitationIds = [...new Set(input.citationIds)];
    if (uniqueCitationIds.length !== input.citationIds.length) {
      throw new ApiError(400, 'duplicate_evidence', 'Each handoff excerpt must be unique.');
    }
    const evidence = uniqueCitationIds.map((id) => {
      const citation = evidenceLookup.get(id, input.projectId) as
        | (ChatGptHandoffRequest['evidence'][number] & {
            available: number;
            unavailabilityReason: string | null;
          })
        | undefined;
      if (!citation) {
        throw new ApiError(400, 'invalid_evidence', 'A handoff evidence excerpt is invalid.');
      }
      if (!citation.available) {
        throw new ApiError(
          409,
          'evidence_unavailable',
          `Citation ${citation.id} is no longer available and cannot be exported.`,
        );
      }
      return {
        id: citation.id,
        sourceName: citation.sourceName,
        locator: citation.locator,
        excerpt: citation.excerpt,
      };
    });
    const handoffId = crypto.randomUUID();
    const digestPayload = {
      formatVersion: 1 as const,
      kind: 'prd-genie-request' as const,
      handoffId,
      projectId: input.projectId,
      sourceRevision: input.revision,
      action: input.action,
      scope: input.scope,
      instruction: input.instruction,
      sections,
      evidence,
    };
    const requestDigest = sha256(JSON.stringify(digestPayload));
    const request: ChatGptHandoffRequest = { ...digestPayload, requestDigest };
    const timestamp = now();
    this.database.db
      .insert(chatGptHandoffs)
      .values({
        id: handoffId,
        projectId: input.projectId,
        sourceRevision: input.revision,
        action: input.action,
        scope: input.scope,
        requestDigest,
        requestJson: JSON.stringify(request),
        status: 'exported',
        createdAt: timestamp,
      })
      .run();
    return this.getChatGptHandoff(input.projectId, handoffId);
  }

  listChatGptHandoffs(projectId: string): ChatGptHandoffSummary[] {
    this.getProject(projectId);
    const rows = this.database.db
      .select({ id: chatGptHandoffs.id })
      .from(chatGptHandoffs)
      .where(eq(chatGptHandoffs.projectId, projectId))
      .orderBy(chatGptHandoffs.createdAt)
      .all()
      .reverse();
    return rows.map((row) => this.getChatGptHandoff(projectId, row.id));
  }

  getChatGptHandoff(projectId: string, id: string): ChatGptHandoffSummary {
    const row = this.database.db
      .select()
      .from(chatGptHandoffs)
      .where(eq(chatGptHandoffs.id, id))
      .get();
    if (!row || row.projectId !== projectId) {
      throw new ApiError(404, 'handoff_not_found', 'ChatGPT handoff not found.');
    }
    return {
      id: row.id,
      projectId: row.projectId,
      sourceRevision: row.sourceRevision,
      action: row.action as ChatGptHandoffSummary['action'],
      scope: row.scope as ChatGptHandoffSummary['scope'],
      status: row.status as ChatGptHandoffSummary['status'],
      request: JSON.parse(row.requestJson) as ChatGptHandoffRequest,
      response: row.responseJson ? (JSON.parse(row.responseJson) as ChatGptHandoffResponse) : null,
      createdAt: row.createdAt,
      importedAt: row.importedAt,
      appliedRevision: row.appliedRevision,
    };
  }

  importChatGptHandoffResponse(
    projectId: string,
    response: ChatGptHandoffResponse,
  ): ChatGptHandoffSummary {
    const handoff = this.getChatGptHandoff(projectId, response.handoffId);
    if (handoff.status !== 'exported') {
      throw new ApiError(409, 'handoff_replayed', 'This handoff already has a response.');
    }
    if (
      response.projectId !== projectId ||
      response.sourceRevision !== handoff.sourceRevision ||
      response.requestDigest !== handoff.request.requestDigest
    ) {
      throw new ApiError(409, 'handoff_mismatch', 'The response does not match this handoff.');
    }
    const current = this.getPrd(projectId);
    if (current.revision !== handoff.sourceRevision) {
      throw new ApiError(409, 'stale_handoff', 'The PRD changed after this handoff was exported.');
    }
    const allowedSections = new Map(
      handoff.request.sections.map((section) => [section.id, section.preimageHash]),
    );
    const allowedEvidence = new Set(handoff.request.evidence.map((evidence) => evidence.id));
    const patchSections = new Set<string>();
    for (const patch of response.patches) {
      if (patchSections.has(patch.sectionId)) {
        throw new ApiError(400, 'duplicate_patch', 'A handoff section can be patched only once.');
      }
      patchSections.add(patch.sectionId);
      if (allowedSections.get(patch.sectionId) !== patch.preimageHash) {
        throw new ApiError(400, 'invalid_patch', 'A patch is outside the exported section scope.');
      }
      if (patch.evidenceIds.some((id) => !allowedEvidence.has(id))) {
        throw new ApiError(
          400,
          'citation_spoofed',
          'A patch cites evidence not sent in the handoff.',
        );
      }
    }
    for (const finding of response.findings) {
      if (!allowedSections.has(finding.sectionId)) {
        throw new ApiError(400, 'invalid_finding', 'A finding targets an unknown section.');
      }
      if (finding.evidenceIds.some((id) => !allowedEvidence.has(id))) {
        throw new ApiError(
          400,
          'citation_spoofed',
          'A finding cites evidence not sent in the handoff.',
        );
      }
    }
    const currentById = new Map(current.sections.map((section) => [section.id, section.body]));
    for (const [sectionId, preimageHash] of allowedSections) {
      const body = currentById.get(sectionId);
      if (body === undefined || sha256(body) !== preimageHash) {
        throw new ApiError(409, 'stale_handoff', 'An exported section changed before import.');
      }
    }
    const responseJson = JSON.stringify(response);
    this.database.db
      .update(chatGptHandoffs)
      .set({
        responseJson,
        responseDigest: sha256(responseJson),
        status: 'staged',
        importedAt: now(),
      })
      .where(eq(chatGptHandoffs.id, handoff.id))
      .run();
    return this.getChatGptHandoff(projectId, handoff.id);
  }

  applyChatGptHandoff(
    projectId: string,
    id: string,
    expectedRevision: number,
    selectedPatches: Array<{ sectionId: string; afterMarkdown: string }>,
  ): PrdDocument {
    const handoff = this.getChatGptHandoff(projectId, id);
    if (handoff.status !== 'staged' || !handoff.response) {
      throw new ApiError(409, 'handoff_closed', 'This handoff is not an open proposal.');
    }
    if (expectedRevision !== handoff.sourceRevision) {
      throw new ApiError(409, 'stale_handoff', 'The PRD revision no longer matches this handoff.');
    }
    const current = this.getPrd(projectId);
    if (current.revision !== expectedRevision) {
      throw new ApiError(409, 'stale_revision', 'The PRD changed after this handoff was imported.');
    }
    const responsePatchById = new Map(
      handoff.response.patches.map((patch) => [patch.sectionId, patch]),
    );
    const selectedIds = new Set<string>();
    for (const patch of selectedPatches) {
      if (selectedIds.has(patch.sectionId) || !responsePatchById.has(patch.sectionId)) {
        throw new ApiError(400, 'invalid_patch', 'A selected handoff patch is invalid.');
      }
      selectedIds.add(patch.sectionId);
    }
    const sectionById = new Map(current.sections.map((section) => [section.id, section]));
    for (const patch of selectedPatches) {
      const currentSection = sectionById.get(patch.sectionId);
      const responsePatch = responsePatchById.get(patch.sectionId);
      if (
        !currentSection ||
        !responsePatch ||
        sha256(currentSection.body) !== responsePatch.preimageHash
      ) {
        throw new ApiError(409, 'stale_handoff', 'A handoff target changed before acceptance.');
      }
    }
    const selectedById = new Map(
      selectedPatches.map((patch) => [patch.sectionId, patch.afterMarkdown]),
    );
    const saved = this.savePrd(
      projectId,
      expectedRevision,
      current.sections.map((section) => ({
        ...section,
        body: selectedById.get(section.id) ?? section.body,
      })),
      `ChatGPT handoff ${id} accepted`,
    );
    this.database.db
      .update(chatGptHandoffs)
      .set({ status: 'applied', appliedRevision: saved.revision })
      .where(eq(chatGptHandoffs.id, id))
      .run();
    return saved;
  }

  dismissChatGptHandoff(projectId: string, id: string): void {
    this.getChatGptHandoff(projectId, id);
    this.database.db.delete(chatGptHandoffs).where(eq(chatGptHandoffs.id, id)).run();
  }

  markAiRunApplied(projectId: string, id: string, revision: number): void {
    const run = this.getAiRun(projectId, id);
    if (run.appliedRevision !== null) {
      throw new ApiError(409, 'proposal_applied', 'This proposal was already applied.');
    }
    this.database.db
      .update(aiRuns)
      .set({ appliedRevision: revision })
      .where(eq(aiRuns.id, id))
      .run();
  }

  storeCitation(input: Omit<typeof citations.$inferInsert, 'id' | 'createdAt'>): string {
    const id = crypto.randomUUID();
    this.database.db
      .insert(citations)
      .values({ id, ...input, createdAt: now() })
      .run();
    return id;
  }

  private listCitationsForRun(aiRunId: string): Citation[] {
    return this.database.sqlite
      .prepare(
        `SELECT id, source_id AS sourceId, source_name AS sourceName,
                location_id AS locationId, locator, chunk_id AS chunkId, excerpt,
                evidence_status AS evidenceStatus, available,
                unavailability_reason AS unavailabilityReason
         FROM citations
         WHERE ai_run_id = ?
         ORDER BY created_at, id`,
      )
      .all(aiRunId)
      .map((row) => {
        const citation = row as Omit<Citation, 'available'> & { available: number };
        return { ...citation, available: Boolean(citation.available) };
      });
  }

  listFindings(projectId: string): ReviewFinding[] {
    const rows = this.database.db
      .select()
      .from(reviewFindings)
      .where(eq(reviewFindings.projectId, projectId))
      .all();
    const citationById = this.database.sqlite.prepare(`
      SELECT id, source_id AS sourceId, source_name AS sourceName,
             location_id AS locationId, locator, chunk_id AS chunkId, excerpt,
             evidence_status AS evidenceStatus, available,
             unavailability_reason AS unavailabilityReason
      FROM citations
      WHERE id = ?
    `);
    return rows.map((row) => {
      const citationIds = JSON.parse(row.citationIdsJson) as string[];
      const findingCitations = citationIds.flatMap((id) => {
        const citation = citationById.get(id) as
          (Omit<Citation, 'available'> & { available: number }) | undefined;
        return citation ? [{ ...citation, available: Boolean(citation.available) }] : [];
      });
      return {
        id: row.id,
        category: row.category as ReviewFinding['category'],
        severity: row.severity as ReviewFinding['severity'],
        targetSectionId: row.targetSectionId,
        rationale: row.rationale,
        citations: findingCitations,
        proposedPatch: row.proposedPatchJson
          ? (JSON.parse(row.proposedPatchJson) as ReviewFinding['proposedPatch'])
          : null,
        sourceRevision: row.sourceRevision,
        status: row.status as ReviewFinding['status'],
      };
    });
  }

  storeFinding(input: {
    aiRunId: string;
    projectId: string;
    category: ReviewFinding['category'];
    severity: ReviewFinding['severity'];
    targetSectionId: string;
    rationale: string;
    citationIds: string[];
    proposedPatch: ReviewFinding['proposedPatch'];
    sourceRevision: number;
  }): ReviewFinding {
    const id = crypto.randomUUID();
    const finding: ReviewFinding = {
      id,
      category: input.category,
      severity: input.severity,
      targetSectionId: input.targetSectionId,
      rationale: input.rationale,
      citations: [],
      proposedPatch: input.proposedPatch,
      sourceRevision: input.sourceRevision,
      status: 'open',
    };
    this.database.db
      .insert(reviewFindings)
      .values({
        id,
        aiRunId: input.aiRunId,
        projectId: input.projectId,
        category: input.category,
        severity: input.severity,
        targetSectionId: input.targetSectionId,
        rationale: input.rationale,
        citationIdsJson: JSON.stringify(input.citationIds),
        proposedPatchJson: input.proposedPatch ? JSON.stringify(input.proposedPatch) : null,
        sourceRevision: input.sourceRevision,
        status: 'open',
        createdAt: now(),
      })
      .run();
    return finding;
  }

  setFindingStatus(projectId: string, findingId: string, status: 'accepted' | 'dismissed'): void {
    const finding = this.database.db
      .select()
      .from(reviewFindings)
      .where(eq(reviewFindings.id, findingId))
      .get();
    if (!finding || finding.projectId !== projectId) {
      throw new ApiError(404, 'finding_not_found', 'Review finding not found.');
    }
    if (finding.status !== 'open') {
      throw new ApiError(409, 'finding_closed', 'This finding is no longer open.');
    }
    this.database.db
      .update(reviewFindings)
      .set({ status })
      .where(eq(reviewFindings.id, findingId))
      .run();
  }

  acceptFinding(
    projectId: string,
    findingId: string,
    expectedRevision: number,
    proposedMarkdown?: string,
  ): PrdDocument {
    let result: PrdDocument | undefined;
    this.database.sqlite.transaction(() => {
      const finding = this.database.db
        .select()
        .from(reviewFindings)
        .where(eq(reviewFindings.id, findingId))
        .get();
      if (!finding || finding.projectId !== projectId) {
        throw new ApiError(404, 'finding_not_found', 'Review finding not found.');
      }
      if (finding.status !== 'open' || finding.sourceRevision !== expectedRevision) {
        throw new ApiError(409, 'stale_finding', 'This finding targets an older PRD revision.');
      }
      const patch = finding.proposedPatchJson
        ? (JSON.parse(finding.proposedPatchJson) as NonNullable<ReviewFinding['proposedPatch']>)
        : null;
      if (!patch) {
        throw new ApiError(
          400,
          'missing_patch',
          'This finding does not include a proposed change.',
        );
      }
      const current = this.getPrd(projectId);
      if (current.revision !== expectedRevision) {
        throw new ApiError(
          409,
          'stale_revision',
          'The PRD changed after this finding was created.',
        );
      }
      const target = current.sections.find((section) => section.id === patch.sectionId);
      if (!target || target.body !== patch.beforeMarkdown) {
        throw new ApiError(409, 'stale_finding', 'The target section changed after this review.');
      }
      this.database.db
        .update(reviewFindings)
        .set({ status: 'accepted' })
        .where(eq(reviewFindings.id, findingId))
        .run();
      result = this.savePrd(
        projectId,
        expectedRevision,
        current.sections.map((section) =>
          section.id === patch.sectionId
            ? { ...section, body: proposedMarkdown ?? patch.afterMarkdown }
            : section,
        ),
        proposedMarkdown === undefined
          ? `Review finding ${findingId} accepted`
          : `Review finding ${findingId} revised and accepted`,
      );
    })();
    if (!result) throw new ApiError(500, 'apply_failed', 'The finding could not be applied.');
    return result;
  }

  restoreRevision(projectId: string, revision: number, expectedRevision: number): PrdDocument {
    const row = this.database.db
      .select()
      .from(revisions)
      .where(eq(revisions.projectId, projectId))
      .all()
      .find((item) => item.revision === revision);
    if (!row) throw new ApiError(404, 'revision_not_found', 'Revision not found.');
    const snapshot = JSON.parse(row.snapshotJson) as PrdSection[];
    return this.savePrd(projectId, expectedRevision, snapshot, `Restored revision ${revision}`);
  }

  getLocation(sourceId: string, locationId: string) {
    const location = this.database.db
      .select({
        id: sourceLocations.id,
        sourceId: sourceLocations.sourceId,
        locator: sourceLocations.locator,
        heading: sourceLocations.heading,
        content: sourceLocations.content,
        startOffset: sourceLocations.startOffset,
        endOffset: sourceLocations.endOffset,
      })
      .from(sourceLocations)
      .where(eq(sourceLocations.id, locationId))
      .get();
    if (!location || location.sourceId !== sourceId) {
      throw new ApiError(404, 'location_not_found', 'Source location not found.');
    }
    return location;
  }
}
