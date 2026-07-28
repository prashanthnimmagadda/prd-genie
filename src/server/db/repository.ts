import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import type {
  AiRunProposal,
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
  citations,
  prdDocuments,
  prdSections,
  projects,
  reviewFindings,
  revisions,
  sourceLocations,
  sources,
} from './schema.js';

function now(): string {
  return new Date().toISOString();
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
    const source = this.database.db.select().from(sources).where(eq(sources.id, sourceId)).get();
    if (!source || source.projectId !== projectId) {
      throw new ApiError(404, 'source_not_found', 'Source not found.');
    }
    this.database.sqlite.transaction(() => {
      if (this.database.vectorAvailable) {
        const vectorIds = this.database.sqlite
          .prepare('SELECT id FROM chunks WHERE source_id = ?')
          .all(sourceId) as Array<{ id: string }>;
        const deleteVector = this.database.sqlite.prepare(
          'DELETE FROM chunk_vectors WHERE chunk_id = ?',
        );
        for (const row of vectorIds) deleteVector.run(row.id);
      }
      this.database.sqlite
        .prepare(
          'DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE source_id = ?)',
        )
        .run(sourceId);
      this.database.db.delete(sources).where(eq(sources.id, sourceId)).run();
    })();
    const remaining = this.database.sqlite
      .prepare('SELECT count(*) AS count FROM sources WHERE binary_path = ?')
      .get(source.binaryPath) as { count: number };
    if (remaining.count > 0) return;
    try {
      fs.unlinkSync(source.binaryPath);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
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
    };
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

  listFindings(projectId: string): ReviewFinding[] {
    const rows = this.database.db
      .select()
      .from(reviewFindings)
      .where(eq(reviewFindings.projectId, projectId))
      .all();
    const citationById = this.database.sqlite.prepare(`
      SELECT citations.id, citations.source_id AS sourceId, sources.name AS sourceName,
             citations.location_id AS locationId, source_locations.locator,
             citations.chunk_id AS chunkId, citations.excerpt,
             citations.evidence_status AS evidenceStatus
      FROM citations
      JOIN sources ON sources.id = citations.source_id
      JOIN source_locations ON source_locations.id = citations.location_id
      WHERE citations.id = ?
    `);
    return rows.map((row) => {
      const citationIds = JSON.parse(row.citationIdsJson) as string[];
      const findingCitations = citationIds.flatMap((id) => {
        const citation = citationById.get(id) as Citation | undefined;
        return citation ? [citation] : [];
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
