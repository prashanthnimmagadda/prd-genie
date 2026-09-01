import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip, { type JSZipObject } from 'jszip';
import { z } from 'zod';
import {
  actionScopes,
  aiActions,
  evidenceStatuses,
  findingCategories,
  providerKinds,
  severityLevels,
  type ProjectSummary,
} from '../../shared/types.js';
import { ApiError } from '../../shared/api.js';
import { config } from '../config.js';
import type { AppDatabase } from '../db/client.js';
import type { Repository } from '../db/repository.js';
import { ensureVerifiedBinary } from '../documents/source-service.js';
import { parseDocumentProposal } from '../providers/proposal-service.js';

const id = z.string().uuid();
const timestamp = z.string().datetime();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sectionSchema = z.object({
  id,
  projectId: id,
  title: z.string().min(1).max(160),
  body: z.string().max(100_000),
  position: z.number().int().nonnegative(),
  updatedAt: timestamp,
});
const sourceSchema = z.object({
  id,
  projectId: id,
  name: z.string().min(1).max(1024),
  mediaType: z.string().min(1).max(200),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(25 * 1024 * 1024),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  archivePath: z.string().min(1).max(1200),
  status: z.enum(['processing', 'ready', 'partial', 'failed']),
  error: z.string().max(4000).nullable(),
  createdAt: timestamp,
});
const locationSchema = z.object({
  id,
  sourceId: id,
  locator: z.string().max(500),
  heading: z.string().max(500).nullable(),
  ordinal: z.number().int().nonnegative(),
  content: z.string().max(config.maxDocxExpandedBytes),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
});
const chunkSchema = z.object({
  id,
  projectId: id,
  sourceId: id,
  locationId: id,
  ordinal: z.number().int().nonnegative(),
  content: z.string().max(100_000),
  tokenCount: z.number().int().nonnegative(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
const portableChunkSchema = chunkSchema.omit({ content: true });
const aiRunSchema = z.object({
  id,
  projectId: id,
  action: z.enum(aiActions),
  scope: z.enum(actionScopes),
  provider: z.enum(providerKinds),
  model: z.string().max(300),
  sourceRevision: z.number().int().nonnegative(),
  targetSectionId: id.nullable(),
  selectionText: z.string().max(50_000).nullable(),
  outputText: z.string().max(500_000).nullable(),
  appliedRevision: z.number().int().nonnegative().nullable(),
  status: z.enum(['running', 'completed', 'failed']),
  errorCode: z.string().max(100).nullable(),
  startedAt: timestamp,
  completedAt: timestamp.nullable(),
});
const citationSchema = z.object({
  id,
  aiRunId: id,
  sourceId: id.nullable(),
  locationId: id.nullable(),
  chunkId: id.nullable(),
  sourceName: z.string().min(1).max(1024),
  locator: z.string().min(1).max(500),
  excerpt: z.string().min(1).max(100_000),
  evidenceStatus: z.enum(evidenceStatuses),
  available: z.boolean(),
  unavailabilityReason: z.literal('source_deleted').nullable(),
  createdAt: timestamp,
});
const findingSchema = z.object({
  id,
  aiRunId: id,
  projectId: id,
  category: z.enum(findingCategories),
  severity: z.enum(severityLevels),
  targetSectionId: id,
  rationale: z.string().max(1200),
  citationIds: z.array(id).max(8),
  proposedPatch: z
    .object({ sectionId: id, beforeMarkdown: z.string(), afterMarkdown: z.string() })
    .nullable(),
  sourceRevision: z.number().int().nonnegative(),
  status: z.enum(['open', 'accepted', 'dismissed', 'stale']),
  createdAt: timestamp,
});
const chatGptHandoffSectionSchema = z
  .object({
    id,
    title: z.string().min(1).max(160),
    markdown: z.string().max(100_000),
    preimageHash: digest,
  })
  .strict();
const chatGptHandoffEvidenceSchema = z
  .object({
    id,
    sourceName: z.string().min(1).max(1024),
    locator: z.string().min(1).max(500),
    excerpt: z.string().min(1).max(100_000),
  })
  .strict();
const chatGptHandoffRequestSchema = z
  .object({
    formatVersion: z.literal(1),
    kind: z.literal('prd-genie-request'),
    handoffId: id,
    projectId: id,
    sourceRevision: z.number().int().nonnegative(),
    requestDigest: digest,
    action: z.enum(['draft', 'review', 'rewrite']),
    scope: z.enum(actionScopes),
    instruction: z.string().min(1).max(10_000),
    sections: z.array(chatGptHandoffSectionSchema).min(1).max(50),
    evidence: z.array(chatGptHandoffEvidenceSchema).max(8),
  })
  .strict();
const chatGptHandoffPatchSchema = z
  .object({
    sectionId: id,
    preimageHash: digest,
    afterMarkdown: z.string().max(100_000),
    evidenceIds: z.array(id).max(8),
  })
  .strict();
const chatGptHandoffResponseSchema = z
  .object({
    formatVersion: z.literal(1),
    kind: z.literal('prd-genie-response'),
    handoffId: id,
    projectId: id,
    sourceRevision: z.number().int().nonnegative(),
    requestDigest: digest,
    summary: z.string().min(1).max(4000),
    patches: z.array(chatGptHandoffPatchSchema).max(50),
    findings: z
      .array(
        z
          .object({
            category: z.enum(findingCategories),
            severity: z.enum(severityLevels),
            sectionId: id,
            rationale: z.string().min(1).max(1200),
            evidenceIds: z.array(id).max(8),
          })
          .strict(),
      )
      .max(20),
    hostModel: z.string().min(1).max(300).nullable(),
  })
  .strict();
const chatGptHandoffApplicationSchema = z
  .object({
    formatVersion: z.literal(1),
    sourceRevision: z.number().int().nonnegative(),
    appliedRevision: z.number().int().nonnegative(),
    patches: z
      .array(
        z
          .object({
            sectionId: id,
            preimageHash: digest,
            proposedAfterMarkdown: z.string().max(100_000),
            appliedAfterMarkdown: z.string().max(100_000),
            evidenceIds: z.array(id).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
const appliedChatGptHandoffSchema = z
  .object({
    id,
    projectId: id,
    sourceRevision: z.number().int().nonnegative(),
    action: z.enum(['draft', 'review', 'rewrite']),
    scope: z.enum(actionScopes),
    requestDigest: digest,
    request: chatGptHandoffRequestSchema,
    responseDigest: digest,
    response: chatGptHandoffResponseSchema,
    appliedRevision: z.number().int().nonnegative(),
    application: chatGptHandoffApplicationSchema.nullable(),
    applicationDigest: digest.nullable(),
    legacyApplicationProvenanceUnavailable: z.boolean(),
    createdAt: timestamp,
    importedAt: timestamp,
    appliedAt: timestamp.nullable(),
    retiredAt: timestamp.nullable(),
  })
  .strict();
const manifestV2Schema = z.object({
  formatVersion: z.literal(2),
  exportedAt: timestamp,
  privacy: z.string(),
  omissions: z.array(z.string()),
  project: z.object({
    id,
    name: z.string().min(1).max(120),
    description: z.string().max(1000),
    selectedProvider: z.enum(providerKinds).nullable(),
    selectedModel: z.string().max(300).nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
  prd: z.object({
    projectId: id,
    revision: z.number().int().nonnegative(),
    sections: z.array(sectionSchema).min(1).max(100),
  }),
  revisions: z
    .array(
      z.object({
        id,
        projectId: id,
        revision: z.number().int().nonnegative(),
        reason: z.string().max(200),
        snapshot: z.array(sectionSchema).min(1).max(100),
        createdAt: timestamp,
      }),
    )
    .max(10_000),
  sources: z.array(sourceSchema).max(500),
  locations: z.array(locationSchema).max(100_000),
  chunks: z.array(chunkSchema).max(200_000),
  aiRuns: z.array(aiRunSchema).max(10_000),
  citations: z.array(citationSchema).max(100_000),
  findings: z.array(findingSchema).max(100_000),
});

const manifestV3Schema = manifestV2Schema.omit({ formatVersion: true }).extend({
  formatVersion: z.literal(3),
  chunks: z.array(portableChunkSchema).max(200_000),
  appliedChatGptHandoffs: z.array(appliedChatGptHandoffSchema).max(10_000),
});
const manifestSchema = z.discriminatedUnion('formatVersion', [manifestV2Schema, manifestV3Schema]);
const internalManifestSchema = manifestV3Schema.extend({
  chunks: z.array(chunkSchema).max(200_000),
});

type ArchiveManifest = z.infer<typeof internalManifestSchema>;

const maxEntries = 1000;
export class ArchiveService {
  constructor(
    private readonly repository: Repository,
    private readonly database: AppDatabase,
  ) {}

  async create(projectId: string): Promise<Buffer> {
    const project = this.repository.getProject(projectId);
    const prd = this.repository.getPrd(projectId);
    const sources = this.database.sqlite
      .prepare(
        `SELECT id, project_id AS projectId, name, media_type AS mediaType, size, hash,
                binary_path AS binaryPath, status, error, created_at AS createdAt
         FROM sources WHERE project_id = ? ORDER BY created_at, id`,
      )
      .all(projectId) as Array<
      Omit<ArchiveManifest['sources'][number], 'archivePath'> & {
        binaryPath: string;
      }
    >;
    const usedPaths = new Set<string>();
    const archivedSources = sources.map((source) => ({
      id: source.id,
      projectId: source.projectId,
      name: source.name,
      mediaType: source.mediaType,
      size: source.size,
      hash: source.hash,
      status: source.status,
      error: source.error,
      createdAt: source.createdAt,
      archivePath: archiveSourcePath(source.name, usedPaths),
    }));
    const revisions = this.database.sqlite
      .prepare(
        `SELECT id, project_id AS projectId, revision, reason, snapshot_json AS snapshotJson,
                created_at AS createdAt
         FROM revisions WHERE project_id = ? ORDER BY revision`,
      )
      .all(projectId)
      .map((value) => {
        const row = value as {
          id: string;
          projectId: string;
          revision: number;
          reason: string;
          snapshotJson: string;
          createdAt: string;
        };
        return {
          id: row.id,
          projectId: row.projectId,
          revision: row.revision,
          reason: row.reason,
          snapshot: JSON.parse(row.snapshotJson) as unknown,
          createdAt: row.createdAt,
        };
      });
    const appliedChatGptHandoffs = this.rows(
      `SELECT id, project_id AS projectId, source_revision AS sourceRevision, action, scope,
              request_digest AS requestDigest, request_json AS requestJson,
              response_digest AS responseDigest, response_json AS responseJson,
              applied_revision AS appliedRevision, application_json AS applicationJson,
              application_digest AS applicationDigest, created_at AS createdAt,
              imported_at AS importedAt, applied_at AS appliedAt, retired_at AS retiredAt
       FROM chatgpt_handoffs
       WHERE project_id = ? AND status = 'applied'
       ORDER BY created_at, id`,
      projectId,
    ).map((value) => {
      const row = value as Record<string, unknown> & {
        requestJson: string;
        responseJson: string;
        applicationJson: string | null;
      };
      const { requestJson, responseJson, applicationJson, ...fields } = row;
      return {
        ...fields,
        request: JSON.parse(requestJson) as unknown,
        response: JSON.parse(responseJson) as unknown,
        application: applicationJson ? (JSON.parse(applicationJson) as unknown) : null,
        legacyApplicationProvenanceUnavailable: applicationJson === null,
      };
    });
    const manifest: ArchiveManifest = internalManifestSchema.parse({
      formatVersion: 3,
      exportedAt: new Date().toISOString(),
      privacy:
        'Contains local project content and source binaries. Contains no provider credentials.',
      omissions: [
        'Session credentials are never persisted or exported.',
        'Unapplied ChatGPT handoffs are omitted because their digests bind the original project identifiers.',
        'Embeddings are omitted and must be regenerated locally.',
      ],
      project,
      prd,
      revisions,
      sources: archivedSources,
      locations: this.rows(
        `SELECT source_locations.id, source_locations.source_id AS sourceId,
                source_locations.locator, source_locations.heading, source_locations.ordinal,
                source_locations.content, source_locations.start_offset AS startOffset,
                source_locations.end_offset AS endOffset
         FROM source_locations JOIN sources ON sources.id = source_locations.source_id
         WHERE sources.project_id = ? ORDER BY source_locations.ordinal`,
        projectId,
      ),
      chunks: this.rows(
        `SELECT id, project_id AS projectId, source_id AS sourceId, location_id AS locationId,
                ordinal, content, token_count AS tokenCount, start_offset AS startOffset,
                end_offset AS endOffset, document_hash AS documentHash
         FROM chunks WHERE project_id = ? ORDER BY source_id, ordinal`,
        projectId,
      ),
      aiRuns: this.rows(
        `SELECT id, project_id AS projectId, action, scope, provider, model,
                source_revision AS sourceRevision, target_section_id AS targetSectionId,
                selection_text AS selectionText, output_text AS outputText,
                applied_revision AS appliedRevision, status, error_code AS errorCode,
                started_at AS startedAt, completed_at AS completedAt
         FROM ai_runs WHERE project_id = ? ORDER BY started_at, id`,
        projectId,
      ),
      citations: this.rows(
        `SELECT citations.id, citations.ai_run_id AS aiRunId, citations.source_id AS sourceId,
                citations.location_id AS locationId, citations.chunk_id AS chunkId,
                citations.source_name AS sourceName, citations.locator, citations.excerpt,
                citations.evidence_status AS evidenceStatus, citations.available,
                citations.unavailability_reason AS unavailabilityReason,
                citations.created_at AS createdAt
         FROM citations JOIN ai_runs ON ai_runs.id = citations.ai_run_id
         WHERE ai_runs.project_id = ? ORDER BY citations.created_at, citations.id`,
        projectId,
      ).map((row) => ({ ...row, available: Boolean((row as { available: number }).available) })),
      findings: this.rows(
        `SELECT id, ai_run_id AS aiRunId, project_id AS projectId, category, severity,
                target_section_id AS targetSectionId, rationale,
                citation_ids_json AS citationIdsJson, proposed_patch_json AS proposedPatchJson,
                source_revision AS sourceRevision, status, created_at AS createdAt
         FROM review_findings WHERE project_id = ? ORDER BY created_at, id`,
        projectId,
      ).map((value) => {
        const row = value as Record<string, unknown> & {
          citationIdsJson: string;
          proposedPatchJson: string | null;
        };
        const { citationIdsJson, proposedPatchJson, ...fields } = row;
        return {
          ...fields,
          citationIds: JSON.parse(citationIdsJson) as unknown,
          proposedPatch: proposedPatchJson ? (JSON.parse(proposedPatchJson) as unknown) : null,
        };
      }),
      appliedChatGptHandoffs,
    });
    const portableManifest = manifestV3Schema.parse({
      ...manifest,
      chunks: manifest.chunks.map(toPortableChunk),
    });
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(portableManifest, null, 2));
    zip.file('prd.md', toMarkdown(project, prd));
    for (const source of archivedSources) {
      const original = sources.find((candidate) => candidate.id === source.id);
      if (!original || !fs.existsSync(original.binaryPath)) {
        throw new ApiError(422, 'archive_source_missing', `Source ${source.name} is unavailable.`);
      }
      const binary = fs.readFileSync(original.binaryPath);
      if (binary.length !== source.size || sha256(binary) !== source.hash) {
        throw new ApiError(
          422,
          'archive_source_corrupt',
          `Source ${source.name} no longer matches its verified content hash.`,
        );
      }
      zip.file(source.archivePath, binary);
    }
    return zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
  }

  async restore(buffer: Buffer): Promise<ProjectSummary> {
    if (buffer.length === 0 || buffer.length > config.maxArchiveBytes) {
      throw new ApiError(413, 'archive_too_large', 'Project archives must be 250 MB or smaller.');
    }
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch {
      throw new ApiError(422, 'invalid_archive', 'The project archive is corrupt.');
    }
    const entries = Object.values(zip.files);
    if (entries.length > maxEntries) {
      throw new ApiError(
        422,
        'archive_entry_limit',
        'The project archive contains too many files.',
      );
    }
    let declaredBytes = 0;
    for (const entry of entries) {
      assertSafeArchivePath(entry.name);
      const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize;
      if (typeof size === 'number') declaredBytes += size;
      if (declaredBytes > config.maxArchiveBytes) {
        throw new ApiError(413, 'archive_too_large', 'The expanded project archive is too large.');
      }
    }
    const manifestEntry = zip.file('project.json');
    if (!manifestEntry) {
      throw new ApiError(422, 'invalid_archive', 'The project archive manifest is missing.');
    }
    const manifestBuffer = await readEntryBounded(
      manifestEntry,
      config.maxArchiveManifestBytes,
      new ApiError(422, 'archive_manifest_limit', 'The project archive manifest is too large.'),
    );
    const manifestText = manifestBuffer.toString('utf8');
    let decoded: unknown;
    try {
      decoded = JSON.parse(manifestText);
    } catch {
      throw new ApiError(422, 'invalid_archive', 'The project archive manifest is invalid JSON.');
    }
    const parsed = manifestSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new ApiError(422, 'invalid_archive', 'The project archive manifest is invalid.');
    }
    const normalized =
      parsed.data.formatVersion === 2
        ? { ...parsed.data, formatVersion: 3 as const, appliedChatGptHandoffs: [] }
        : {
            ...parsed.data,
            chunks: restorePortableChunkContent(parsed.data.locations, parsed.data.chunks),
          };
    const internal = internalManifestSchema.safeParse(normalized);
    if (!internal.success) {
      throw new ApiError(422, 'invalid_archive', 'The project archive manifest is invalid.');
    }
    const manifest = internal.data;
    validateManifestReferences(manifest);
    const permittedEntries = new Set([
      'project.json',
      'prd.md',
      ...manifest.sources.map((source) => source.archivePath),
    ]);
    if (entries.some((entry) => !entry.dir && !permittedEntries.has(entry.name))) {
      throw new ApiError(422, 'invalid_archive', 'The project archive contains unknown files.');
    }
    const binaries = new Map<string, Buffer>();
    let actualBytes = manifestBuffer.length;
    for (const source of manifest.sources) {
      const entry = zip.file(source.archivePath);
      if (!entry) {
        throw new ApiError(422, 'invalid_archive', `Source ${source.name} is missing.`);
      }
      const binary = await readEntryBounded(
        entry,
        source.size,
        new ApiError(422, 'archive_hash_mismatch', `Source ${source.name} failed validation.`),
      );
      actualBytes += binary.length;
      if (
        actualBytes > config.maxArchiveBytes ||
        binary.length !== source.size ||
        sha256(binary) !== source.hash
      ) {
        throw new ApiError(
          422,
          'archive_hash_mismatch',
          `Source ${source.name} failed validation.`,
        );
      }
      binaries.set(source.id, binary);
    }
    return this.insertRestored(manifest, binaries);
  }

  private insertRestored(manifest: ArchiveManifest, binaries: Map<string, Buffer>): ProjectSummary {
    const projectId = crypto.randomUUID();
    const sectionIds = idMap([
      ...new Set([
        ...manifest.prd.sections.map((row) => row.id),
        ...manifest.revisions.flatMap((revision) => revision.snapshot.map((section) => section.id)),
        ...manifest.aiRuns.flatMap((run) => (run.targetSectionId ? [run.targetSectionId] : [])),
        ...manifest.appliedChatGptHandoffs.flatMap((handoff) =>
          handoff.request.sections.map((section) => section.id),
        ),
      ]),
    ]);
    const sourceIds = idMap(manifest.sources.map((row) => row.id));
    const locationIds = idMap(manifest.locations.map((row) => row.id));
    const chunkIds = idMap(manifest.chunks.map((row) => row.id));
    const runIds = idMap(manifest.aiRuns.map((row) => row.id));
    const citationIds = idMap(manifest.citations.map((row) => row.id));
    const findingIds = idMap(manifest.findings.map((row) => row.id));
    const handoffIds = idMap(manifest.appliedChatGptHandoffs.map((row) => row.id));
    const timestampNow = new Date().toISOString();
    const createdPaths: string[] = [];
    const sourcePaths = new Map<string, string>();
    fs.mkdirSync(config.sourceDir, { recursive: true, mode: 0o700 });
    try {
      for (const source of manifest.sources) {
        const extension = safeSourceExtension(source.name, source.mediaType);
        const binaryPath = path.join(config.sourceDir, `${source.hash}${extension}`);
        if (ensureVerifiedBinary(binaryPath, binaries.get(source.id)!, source.hash)) {
          createdPaths.push(binaryPath);
        }
        sourcePaths.set(source.id, binaryPath);
      }
      this.database.sqlite.transaction(() => {
        this.database.sqlite
          .prepare(
            `INSERT INTO projects
             (id, name, description, selected_provider, selected_model, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            projectId,
            manifest.project.name,
            manifest.project.description,
            manifest.project.selectedProvider,
            manifest.project.selectedModel,
            timestampNow,
            timestampNow,
          );
        const insertSource = this.database.sqlite.prepare(
          `INSERT INTO sources
           (id, project_id, name, media_type, size, hash, binary_path, status, error, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'partial', ?, ?)`,
        );
        for (const source of manifest.sources) {
          insertSource.run(
            sourceIds.get(source.id),
            projectId,
            source.name,
            source.mediaType,
            source.size,
            source.hash,
            sourcePaths.get(source.id),
            'Restored with lexical indexing. Retry semantic indexing when the local model is ready.',
            source.createdAt,
          );
        }
        const insertLocation = this.database.sqlite.prepare(
          `INSERT INTO source_locations
           (id, source_id, locator, heading, ordinal, content, start_offset, end_offset)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const location of manifest.locations) {
          insertLocation.run(
            locationIds.get(location.id),
            sourceIds.get(location.sourceId),
            location.locator,
            location.heading,
            location.ordinal,
            location.content,
            location.startOffset,
            location.endOffset,
          );
        }
        const insertChunk = this.database.sqlite.prepare(
          `INSERT INTO chunks
           (id, project_id, source_id, location_id, ordinal, content, token_count,
            start_offset, end_offset, document_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const insertFts = this.database.sqlite.prepare(
          'INSERT INTO chunks_fts (chunk_id, project_id, content) VALUES (?, ?, ?)',
        );
        for (const chunk of manifest.chunks) {
          const mappedChunkId = chunkIds.get(chunk.id)!;
          insertChunk.run(
            mappedChunkId,
            projectId,
            sourceIds.get(chunk.sourceId),
            locationIds.get(chunk.locationId),
            chunk.ordinal,
            chunk.content,
            chunk.tokenCount,
            chunk.startOffset,
            chunk.endOffset,
            chunk.documentHash,
          );
          insertFts.run(mappedChunkId, projectId, chunk.content);
        }
        this.database.sqlite
          .prepare('INSERT INTO prd_documents (project_id, revision, updated_at) VALUES (?, ?, ?)')
          .run(projectId, manifest.prd.revision, timestampNow);
        const insertSection = this.database.sqlite.prepare(
          `INSERT INTO prd_sections (id, project_id, title, body, position, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const section of manifest.prd.sections) {
          insertSection.run(
            sectionIds.get(section.id),
            projectId,
            section.title,
            section.body,
            section.position,
            section.updatedAt,
          );
        }
        const insertRevision = this.database.sqlite.prepare(
          `INSERT INTO revisions (id, project_id, revision, reason, snapshot_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const revision of manifest.revisions) {
          insertRevision.run(
            crypto.randomUUID(),
            projectId,
            revision.revision,
            remapRevisionReason(revision.reason, runIds, findingIds, handoffIds),
            JSON.stringify(
              revision.snapshot.map((section) => ({
                ...section,
                id: sectionIds.get(section.id),
                projectId,
              })),
            ),
            revision.createdAt,
          );
        }
        const insertRun = this.database.sqlite.prepare(
          `INSERT INTO ai_runs
           (id, project_id, action, scope, provider, model, source_revision,
            target_section_id, selection_text, output_text, applied_revision, status,
            error_code, started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const run of manifest.aiRuns) {
          insertRun.run(
            runIds.get(run.id),
            projectId,
            run.action,
            run.scope,
            run.provider,
            run.model,
            run.sourceRevision,
            run.targetSectionId ? sectionIds.get(run.targetSectionId) : null,
            run.selectionText,
            remapRunOutput(run, sectionIds),
            run.appliedRevision,
            run.status,
            run.errorCode,
            run.startedAt,
            run.completedAt,
          );
        }
        const insertCitation = this.database.sqlite.prepare(
          `INSERT INTO citations
           (id, ai_run_id, source_id, location_id, chunk_id, source_name, locator,
            excerpt, evidence_status, available, unavailability_reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const citation of manifest.citations) {
          insertCitation.run(
            citationIds.get(citation.id),
            runIds.get(citation.aiRunId),
            citation.sourceId ? sourceIds.get(citation.sourceId) : null,
            citation.locationId ? locationIds.get(citation.locationId) : null,
            citation.chunkId ? chunkIds.get(citation.chunkId) : null,
            citation.sourceName,
            citation.locator,
            citation.excerpt,
            citation.evidenceStatus,
            citation.available ? 1 : 0,
            citation.unavailabilityReason,
            citation.createdAt,
          );
        }
        const insertFinding = this.database.sqlite.prepare(
          `INSERT INTO review_findings
           (id, ai_run_id, project_id, category, severity, target_section_id, rationale,
            citation_ids_json, proposed_patch_json, source_revision, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const finding of manifest.findings) {
          insertFinding.run(
            findingIds.get(finding.id),
            runIds.get(finding.aiRunId),
            projectId,
            finding.category,
            finding.severity,
            sectionIds.get(finding.targetSectionId),
            finding.rationale,
            JSON.stringify(finding.citationIds.map((citationId) => citationIds.get(citationId))),
            finding.proposedPatch
              ? JSON.stringify({
                  ...finding.proposedPatch,
                  sectionId: sectionIds.get(finding.proposedPatch.sectionId),
                })
              : null,
            finding.sourceRevision,
            finding.status,
            finding.createdAt,
          );
        }
        const insertHandoff = this.database.sqlite.prepare(
          `INSERT INTO chatgpt_handoffs
           (id, project_id, source_revision, action, scope, request_digest, request_json,
            response_digest, response_json, status, created_at, imported_at, applied_revision,
            application_json, application_digest, applied_at, retired_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const handoff of manifest.appliedChatGptHandoffs) {
          const remapped = remapChatGptHandoff(
            handoff,
            projectId,
            handoffIds,
            sectionIds,
            citationIds,
          );
          insertHandoff.run(
            remapped.id,
            projectId,
            handoff.sourceRevision,
            handoff.action,
            handoff.scope,
            remapped.requestDigest,
            JSON.stringify(remapped.request),
            remapped.responseDigest,
            JSON.stringify(remapped.response),
            handoff.createdAt,
            handoff.importedAt,
            handoff.appliedRevision,
            remapped.application ? JSON.stringify(remapped.application) : null,
            remapped.applicationDigest,
            handoff.appliedAt,
            handoff.retiredAt,
          );
        }
      })();
    } catch (error) {
      for (const binaryPath of createdPaths) {
        try {
          fs.unlinkSync(binaryPath);
        } catch {
          // Preserve the original validation or database error.
        }
      }
      throw error;
    }
    return this.repository.getProject(projectId);
  }

  private rows(sql: string, value: string): Array<Record<string, unknown>> {
    return this.database.sqlite.prepare(sql).all(value) as Array<Record<string, unknown>>;
  }
}

function validateManifestReferences(manifest: ArchiveManifest): void {
  unique(
    manifest.prd.sections.map((row) => row.id),
    'section',
  );
  unique(
    manifest.sources.map((row) => row.id),
    'source',
  );
  unique(
    manifest.sources.map((row) => row.hash),
    'source hash',
  );
  unique(
    manifest.sources.map((row) => row.archivePath),
    'source path',
  );
  if (manifest.sources.some((row) => !/^sources\/[^/]+$/.test(row.archivePath))) {
    invalidReferences();
  }
  unique(
    manifest.locations.map((row) => row.id),
    'location',
  );
  unique(
    manifest.chunks.map((row) => row.id),
    'chunk',
  );
  unique(
    manifest.aiRuns.map((row) => row.id),
    'AI run',
  );
  unique(
    manifest.citations.map((row) => row.id),
    'citation',
  );
  unique(
    manifest.findings.map((row) => row.id),
    'finding',
  );
  unique(
    manifest.appliedChatGptHandoffs.map((row) => row.id),
    'ChatGPT handoff',
  );
  for (const revision of manifest.revisions) {
    unique(
      revision.snapshot.map((section) => section.id),
      `revision ${revision.revision} section`,
    );
  }
  const revisionNumbers = manifest.revisions.map((row) => row.revision);
  if (
    revisionNumbers.length !== manifest.prd.revision + 1 ||
    revisionNumbers.some((revision, index) => revision !== index) ||
    !validSectionOrder(manifest.prd.sections) ||
    manifest.revisions.some((revision) => !validSectionOrder(revision.snapshot)) ||
    !sameSections(manifest.revisions.at(-1)?.snapshot, manifest.prd.sections)
  ) {
    invalidReferences();
  }
  if (manifest.prd.projectId !== manifest.project.id) invalidReferences();
  const sources = new Set(manifest.sources.map((row) => row.id));
  const sourcesById = new Map(manifest.sources.map((row) => [row.id, row]));
  const sourceHashes = new Map(manifest.sources.map((row) => [row.id, row.hash]));
  const locations = new Map(manifest.locations.map((row) => [row.id, row]));
  const chunks = new Map(manifest.chunks.map((row) => [row.id, row]));
  const validRevisions = new Set(revisionNumbers);
  const revisionSections = new Map(
    manifest.revisions.map((revision) => [
      revision.revision,
      new Map(revision.snapshot.map((section) => [section.id, section])),
    ]),
  );
  const revisionsByNumber = new Map(
    manifest.revisions.map((revision) => [revision.revision, revision]),
  );
  const runs = new Map(manifest.aiRuns.map((row) => [row.id, row]));
  const findingsById = new Map(manifest.findings.map((row) => [row.id, row]));
  const handoffsById = new Map(manifest.appliedChatGptHandoffs.map((row) => [row.id, row]));
  const citationRuns = new Map(manifest.citations.map((row) => [row.id, row.aiRunId]));
  const citationAvailability = new Map(manifest.citations.map((row) => [row.id, row.available]));
  const citationsById = new Map(manifest.citations.map((row) => [row.id, row]));
  const citations = new Set(manifest.citations.map((row) => row.id));
  const appliedRevisions = new Set<number>();
  const invalidRun = manifest.aiRuns.some((row) => {
    const sourceSections = revisionSections.get(row.sourceRevision);
    const target =
      row.targetSectionId === null ? undefined : sourceSections?.get(row.targetSectionId);
    if (
      row.projectId !== manifest.project.id ||
      !sourceSections ||
      (row.scope !== 'document' && row.targetSectionId === null) ||
      (row.targetSectionId !== null && !target) ||
      (row.scope === 'selection'
        ? row.selectionText === null ||
          !row.selectionText.trim() ||
          !target?.body.includes(row.selectionText)
        : row.selectionText !== null)
    ) {
      return true;
    }
    if (row.appliedRevision === null) return false;
    const appliedRevision = revisionsByNumber.get(row.appliedRevision);
    if (
      !appliedRevision ||
      row.appliedRevision !== row.sourceRevision + 1 ||
      row.status !== 'completed' ||
      (row.action !== 'draft' && row.action !== 'rewrite') ||
      !row.outputText?.trim() ||
      appliedRevisions.has(row.appliedRevision) ||
      !validAiApplication(row, revisionsByNumber.get(row.sourceRevision)!.snapshot, appliedRevision)
    ) {
      return true;
    }
    appliedRevisions.add(row.appliedRevision);
    return false;
  });
  const invalidApplicationReason = manifest.revisions.some((revision) => {
    if (revision.reason.startsWith('AI run ')) {
      const match = revision.reason.match(
        /^AI run ([0-9a-f-]{36}) (accepted|revised and accepted)$/i,
      );
      const run = match?.[1] ? runs.get(match[1]) : undefined;
      return !run || run.appliedRevision !== revision.revision;
    }
    if (revision.reason.startsWith('Review finding ')) {
      const match = revision.reason.match(
        /^Review finding ([0-9a-f-]{36}) (accepted|revised and accepted)$/i,
      );
      const finding = match?.[1] ? findingsById.get(match[1]) : undefined;
      return (
        !finding ||
        finding.status !== 'accepted' ||
        finding.sourceRevision + 1 !== revision.revision
      );
    }
    if (revision.reason.startsWith('ChatGPT handoff ')) {
      const match = revision.reason.match(
        /^ChatGPT handoff ([0-9a-f-]{36}) (accepted|revised and accepted)$/i,
      );
      const handoff = match?.[1] ? handoffsById.get(match[1]) : undefined;
      return !handoff || handoff.appliedRevision !== revision.revision;
    }
    return false;
  });
  const invalidFinding = manifest.findings.some((row) => {
    const run = runs.get(row.aiRunId);
    const sourceSection = revisionSections.get(row.sourceRevision)?.get(row.targetSectionId);
    const acceptedRevision = revisionsByNumber.get(row.sourceRevision + 1);
    if (
      row.projectId !== manifest.project.id ||
      !run ||
      run.action !== 'review' ||
      !validRevisions.has(row.sourceRevision) ||
      row.sourceRevision !== run.sourceRevision ||
      !sourceSection ||
      row.citationIds.some(
        (citation) => !citations.has(citation) || citationRuns.get(citation) !== row.aiRunId,
      ) ||
      (row.status === 'open' &&
        row.citationIds.some((citation) => !citationAvailability.get(citation))) ||
      (row.proposedPatch !== null &&
        (row.proposedPatch.sectionId !== row.targetSectionId ||
          row.proposedPatch.beforeMarkdown !== sourceSection.body)) ||
      (row.status === 'accepted' &&
        (!row.proposedPatch ||
          !acceptedRevision ||
          !validFindingApplication(
            row,
            revisionsByNumber.get(row.sourceRevision)!.snapshot,
            acceptedRevision,
          )))
    ) {
      return true;
    }
    if (row.status === 'accepted') {
      const appliedRevision = row.sourceRevision + 1;
      if (appliedRevisions.has(appliedRevision)) return true;
      appliedRevisions.add(appliedRevision);
    }
    return false;
  });
  const invalidHandoff = manifest.appliedChatGptHandoffs.some((handoff) => {
    if (
      !validChatGptHandoff(
        handoff,
        manifest.project.id,
        revisionSections,
        revisionsByNumber,
        citationsById,
      ) ||
      appliedRevisions.has(handoff.appliedRevision)
    ) {
      return true;
    }
    appliedRevisions.add(handoff.appliedRevision);
    return false;
  });
  if (
    manifest.prd.sections.some((row) => row.projectId !== manifest.project.id) ||
    manifest.revisions.some(
      (row) =>
        row.projectId !== manifest.project.id ||
        row.snapshot.some((section) => section.projectId !== manifest.project.id),
    ) ||
    manifest.sources.some((row) => row.projectId !== manifest.project.id) ||
    manifest.locations.some((row) => !sources.has(row.sourceId)) ||
    manifest.chunks.some(
      (row) =>
        row.projectId !== manifest.project.id ||
        !sources.has(row.sourceId) ||
        locations.get(row.locationId)?.sourceId !== row.sourceId ||
        sourceHashes.get(row.sourceId) !== row.documentHash,
    ) ||
    invalidRun ||
    invalidFinding ||
    invalidHandoff ||
    invalidApplicationReason ||
    manifest.citations.some((row) => {
      const chunk = row.chunkId === null ? undefined : chunks.get(row.chunkId);
      const source = row.sourceId === null ? undefined : sourcesById.get(row.sourceId);
      const location = row.locationId === null ? undefined : locations.get(row.locationId);
      return (
        !runs.has(row.aiRunId) ||
        (row.available
          ? row.sourceId === null ||
            row.locationId === null ||
            row.chunkId === null ||
            row.unavailabilityReason !== null ||
            !source ||
            !location ||
            !chunk ||
            location.sourceId !== row.sourceId ||
            chunk.sourceId !== row.sourceId ||
            chunk.locationId !== row.locationId ||
            row.sourceName !== source.name ||
            row.locator !== location.locator ||
            row.excerpt !== chunk.content
          : row.sourceId !== null ||
            row.locationId !== null ||
            row.chunkId !== null ||
            row.unavailabilityReason !== 'source_deleted')
      );
    })
  ) {
    invalidReferences();
  }
}

function validChatGptHandoff(
  handoff: ArchiveManifest['appliedChatGptHandoffs'][number],
  projectId: string,
  revisionSections: Map<number, Map<string, ArchiveManifest['prd']['sections'][number]>>,
  revisionsByNumber: Map<number, ArchiveManifest['revisions'][number]>,
  citationsById: Map<string, ArchiveManifest['citations'][number]>,
): boolean {
  const request = handoff.request;
  const response = handoff.response;
  const requestPayload = requestDigestPayload(request);
  const sourceSections = revisionSections.get(handoff.sourceRevision);
  const appliedRevision = revisionsByNumber.get(handoff.appliedRevision);
  if (
    handoff.projectId !== projectId ||
    handoff.sourceRevision !== request.sourceRevision ||
    handoff.action !== request.action ||
    handoff.scope !== request.scope ||
    request.handoffId !== handoff.id ||
    request.projectId !== projectId ||
    handoff.requestDigest !== request.requestDigest ||
    request.requestDigest !== sha256(JSON.stringify(requestPayload)) ||
    response.handoffId !== handoff.id ||
    response.projectId !== projectId ||
    response.sourceRevision !== handoff.sourceRevision ||
    response.requestDigest !== request.requestDigest ||
    handoff.responseDigest !== sha256(JSON.stringify(response)) ||
    handoff.appliedRevision !== handoff.sourceRevision + 1 ||
    !sourceSections ||
    !appliedRevision
  ) {
    return false;
  }
  const requestSectionIds = request.sections.map((section) => section.id);
  const requestEvidenceIds = request.evidence.map((evidence) => evidence.id);
  if (
    new Set(requestSectionIds).size !== requestSectionIds.length ||
    new Set(requestEvidenceIds).size !== requestEvidenceIds.length ||
    request.sections.some((section) => {
      const source = sourceSections.get(section.id);
      return (
        !source ||
        section.title !== source.title ||
        section.markdown !== source.body ||
        section.preimageHash !== sha256(source.body)
      );
    }) ||
    request.evidence.some((evidence) => {
      const citation = citationsById.get(evidence.id);
      return (
        !citation ||
        evidence.sourceName !== citation.sourceName ||
        evidence.locator !== citation.locator ||
        evidence.excerpt !== citation.excerpt
      );
    })
  ) {
    return false;
  }
  const allowedSections = new Map(
    request.sections.map((section) => [section.id, section.preimageHash]),
  );
  const allowedEvidence = new Set(requestEvidenceIds);
  const responsePatchSections = response.patches.map((patch) => patch.sectionId);
  if (
    new Set(responsePatchSections).size !== responsePatchSections.length ||
    response.patches.some(
      (patch) =>
        allowedSections.get(patch.sectionId) !== patch.preimageHash ||
        patch.evidenceIds.some((evidenceId) => !allowedEvidence.has(evidenceId)),
    ) ||
    response.findings.some(
      (finding) =>
        !allowedSections.has(finding.sectionId) ||
        finding.evidenceIds.some((evidenceId) => !allowedEvidence.has(evidenceId)),
    )
  ) {
    return false;
  }
  if (handoff.application === null) {
    return (
      handoff.legacyApplicationProvenanceUnavailable &&
      handoff.applicationDigest === null &&
      appliedRevision.reason.startsWith(`ChatGPT handoff ${handoff.id} `)
    );
  }
  const application = handoff.application;
  if (
    handoff.legacyApplicationProvenanceUnavailable ||
    handoff.applicationDigest !== sha256(JSON.stringify(application)) ||
    application.sourceRevision !== handoff.sourceRevision ||
    application.appliedRevision !== handoff.appliedRevision ||
    !sameSectionShape([...sourceSections.values()], appliedRevision.snapshot)
  ) {
    return false;
  }
  const responsePatches = new Map(response.patches.map((patch) => [patch.sectionId, patch]));
  const appliedSectionIds = application.patches.map((patch) => patch.sectionId);
  if (
    new Set(appliedSectionIds).size !== appliedSectionIds.length ||
    application.patches.some((patch) => {
      const proposed = responsePatches.get(patch.sectionId);
      const source = sourceSections.get(patch.sectionId);
      const applied = appliedRevision.snapshot.find((section) => section.id === patch.sectionId);
      return (
        !proposed ||
        !source ||
        !applied ||
        patch.preimageHash !== proposed.preimageHash ||
        patch.preimageHash !== sha256(source.body) ||
        patch.proposedAfterMarkdown !== proposed.afterMarkdown ||
        patch.appliedAfterMarkdown !== applied.body ||
        JSON.stringify(patch.evidenceIds) !== JSON.stringify(proposed.evidenceIds)
      );
    }) ||
    [...sourceSections.values()].some((source) => {
      const applied = appliedRevision.snapshot.find((section) => section.id === source.id);
      return !appliedSectionIds.includes(source.id) && applied?.body !== source.body;
    })
  ) {
    return false;
  }
  const revised = application.patches.some(
    (patch) => patch.proposedAfterMarkdown !== patch.appliedAfterMarkdown,
  );
  return (
    appliedRevision.reason ===
    `ChatGPT handoff ${handoff.id} ${revised ? 'revised and accepted' : 'accepted'}`
  );
}

function requestDigestPayload(request: z.infer<typeof chatGptHandoffRequestSchema>) {
  return {
    formatVersion: request.formatVersion,
    kind: request.kind,
    handoffId: request.handoffId,
    projectId: request.projectId,
    sourceRevision: request.sourceRevision,
    action: request.action,
    scope: request.scope,
    instruction: request.instruction,
    sections: request.sections,
    evidence: request.evidence,
  };
}

function validAiApplication(
  run: ArchiveManifest['aiRuns'][number],
  source: ArchiveManifest['prd']['sections'],
  applied: ArchiveManifest['revisions'][number],
): boolean {
  const acceptedReason = `AI run ${run.id} accepted`;
  const revisedReason = `AI run ${run.id} revised and accepted`;
  const revised = applied.reason === revisedReason;
  if (applied.reason !== acceptedReason && !revised) return false;
  if (!sameSectionShape(source, applied.snapshot)) return false;
  if (run.scope === 'document') {
    try {
      const expected = parseDocumentProposal(run.outputText!, source);
      return revised || sameSectionBodies(expected, applied.snapshot);
    } catch {
      return false;
    }
  }
  if (!run.targetSectionId) return false;
  const sourceTarget = source.find((section) => section.id === run.targetSectionId);
  const appliedTarget = applied.snapshot.find((section) => section.id === run.targetSectionId);
  if (
    !sourceTarget ||
    !appliedTarget ||
    !sameUntargetedBodies(source, applied.snapshot, run.targetSectionId)
  ) {
    return false;
  }
  if (run.scope === 'section') {
    return revised || appliedTarget.body === run.outputText;
  }
  if (!run.selectionText) return false;
  const first = sourceTarget.body.indexOf(run.selectionText);
  if (first < 0 || first !== sourceTarget.body.lastIndexOf(run.selectionText)) return false;
  const prefix = sourceTarget.body.slice(0, first);
  const suffix = sourceTarget.body.slice(first + run.selectionText.length);
  return revised
    ? appliedTarget.body.startsWith(prefix) && appliedTarget.body.endsWith(suffix)
    : appliedTarget.body === `${prefix}${run.outputText!}${suffix}`;
}

function validFindingApplication(
  finding: ArchiveManifest['findings'][number],
  source: ArchiveManifest['prd']['sections'],
  applied: ArchiveManifest['revisions'][number],
): boolean {
  const acceptedReason = `Review finding ${finding.id} accepted`;
  const revisedReason = `Review finding ${finding.id} revised and accepted`;
  const revised = applied.reason === revisedReason;
  if (applied.reason !== acceptedReason && !revised) return false;
  if (
    !sameSectionShape(source, applied.snapshot) ||
    !sameUntargetedBodies(source, applied.snapshot, finding.targetSectionId)
  ) {
    return false;
  }
  if (revised) return true;
  return (
    applied.snapshot.find((section) => section.id === finding.targetSectionId)?.body ===
    finding.proposedPatch?.afterMarkdown
  );
}

function sameSectionShape(
  left: ArchiveManifest['prd']['sections'],
  right: ArchiveManifest['prd']['sections'],
): boolean {
  return (
    left.length === right.length &&
    left.every((section, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        section.id === candidate.id &&
        section.projectId === candidate.projectId &&
        section.title === candidate.title &&
        section.position === candidate.position
      );
    })
  );
}

function sameSectionBodies(
  left: ArchiveManifest['prd']['sections'],
  right: ArchiveManifest['prd']['sections'],
): boolean {
  return (
    sameSectionShape(left, right) &&
    left.every((section, index) => section.body === right[index]!.body)
  );
}

function sameUntargetedBodies(
  left: ArchiveManifest['prd']['sections'],
  right: ArchiveManifest['prd']['sections'],
  targetSectionId: string,
): boolean {
  return left.every(
    (section, index) => section.id === targetSectionId || section.body === right[index]?.body,
  );
}

function remapRevisionReason(
  reason: string,
  runIds: Map<string, string>,
  findingIds: Map<string, string>,
  handoffIds: Map<string, string>,
): string {
  const run = reason.match(/^AI run ([0-9a-f-]{36}) (accepted|revised and accepted)$/i);
  if (run?.[1]) {
    const mapped = runIds.get(run[1]);
    if (mapped) return `AI run ${mapped} ${run[2]}`;
  }
  const finding = reason.match(/^Review finding ([0-9a-f-]{36}) (accepted|revised and accepted)$/i);
  if (finding?.[1]) {
    const mapped = findingIds.get(finding[1]);
    if (mapped) return `Review finding ${mapped} ${finding[2]}`;
  }
  const handoff = reason.match(
    /^ChatGPT handoff ([0-9a-f-]{36}) (accepted|revised and accepted)$/i,
  );
  if (handoff?.[1]) {
    const mapped = handoffIds.get(handoff[1]);
    if (mapped) return `ChatGPT handoff ${mapped} ${handoff[2]}`;
  }
  return reason;
}

function remapChatGptHandoff(
  handoff: ArchiveManifest['appliedChatGptHandoffs'][number],
  projectId: string,
  handoffIds: Map<string, string>,
  sectionIds: Map<string, string>,
  citationIds: Map<string, string>,
) {
  const mappedId = handoffIds.get(handoff.id)!;
  const requestPayload = {
    formatVersion: 1 as const,
    kind: 'prd-genie-request' as const,
    handoffId: mappedId,
    projectId,
    sourceRevision: handoff.request.sourceRevision,
    action: handoff.request.action,
    scope: handoff.request.scope,
    instruction: handoff.request.instruction,
    sections: handoff.request.sections.map((section) => ({
      ...section,
      id: sectionIds.get(section.id)!,
    })),
    evidence: handoff.request.evidence.map((evidence) => ({
      ...evidence,
      id: citationIds.get(evidence.id)!,
    })),
  };
  const requestDigest = sha256(JSON.stringify(requestPayload));
  const request = { ...requestPayload, requestDigest };
  const response = {
    ...handoff.response,
    handoffId: mappedId,
    projectId,
    requestDigest,
    patches: handoff.response.patches.map((patch) => ({
      ...patch,
      sectionId: sectionIds.get(patch.sectionId)!,
      evidenceIds: patch.evidenceIds.map((evidenceId) => citationIds.get(evidenceId)!),
    })),
    findings: handoff.response.findings.map((finding) => ({
      ...finding,
      sectionId: sectionIds.get(finding.sectionId)!,
      evidenceIds: finding.evidenceIds.map((evidenceId) => citationIds.get(evidenceId)!),
    })),
  };
  const responseDigest = sha256(JSON.stringify(response));
  const application = handoff.application
    ? {
        ...handoff.application,
        patches: handoff.application.patches.map((patch) => ({
          ...patch,
          sectionId: sectionIds.get(patch.sectionId)!,
          evidenceIds: patch.evidenceIds.map((evidenceId) => citationIds.get(evidenceId)!),
        })),
      }
    : null;
  return {
    id: mappedId,
    request,
    requestDigest,
    response,
    responseDigest,
    application,
    applicationDigest: application ? sha256(JSON.stringify(application)) : null,
  };
}

function remapRunOutput(
  run: ArchiveManifest['aiRuns'][number],
  sectionIds: Map<string, string>,
): string | null {
  if (run.scope !== 'document' || !run.outputText) return run.outputText;
  return run.outputText.replace(
    /(<!--\s*section:)([0-9a-f-]{36})(\s*-->)/gi,
    (marker, prefix: string, sectionId: string, suffix: string) => {
      const mapped = sectionIds.get(sectionId);
      return mapped ? `${prefix}${mapped}${suffix}` : marker;
    },
  );
}

function validSectionOrder(sections: ArchiveManifest['prd']['sections']): boolean {
  return sections.every((section, index) => section.position === index);
}

function sameSections(
  left: ArchiveManifest['prd']['sections'] | undefined,
  right: ArchiveManifest['prd']['sections'],
): boolean {
  if (!left || left.length !== right.length) return false;
  return left.every((section, index) => {
    const candidate = right[index];
    return (
      candidate !== undefined &&
      section.id === candidate.id &&
      section.projectId === candidate.projectId &&
      section.title === candidate.title &&
      section.body === candidate.body &&
      section.position === candidate.position &&
      section.updatedAt === candidate.updatedAt
    );
  });
}

function invalidReferences(): never {
  throw new ApiError(422, 'invalid_archive', 'The project archive contains invalid references.');
}

function restorePortableChunkContent(
  locations: z.infer<typeof locationSchema>[],
  chunks: z.infer<typeof portableChunkSchema>[],
): z.infer<typeof chunkSchema>[] {
  const locationsById = new Map(locations.map((location) => [location.id, location]));
  return chunks.map((chunk) => {
    const location = locationsById.get(chunk.locationId);
    if (
      !location ||
      location.endOffset < location.startOffset ||
      chunk.endOffset < chunk.startOffset ||
      chunk.startOffset < location.startOffset ||
      chunk.endOffset > location.endOffset
    ) {
      invalidReferences();
    }
    const relativeStart = chunk.startOffset - location.startOffset;
    const relativeEnd = chunk.endOffset - location.startOffset;
    const content = location.content.slice(relativeStart, relativeEnd);
    if (content.length !== chunk.endOffset - chunk.startOffset) invalidReferences();
    return { ...chunk, content };
  });
}

function toPortableChunk(chunk: z.infer<typeof chunkSchema>): z.infer<typeof portableChunkSchema> {
  return {
    id: chunk.id,
    projectId: chunk.projectId,
    sourceId: chunk.sourceId,
    locationId: chunk.locationId,
    ordinal: chunk.ordinal,
    tokenCount: chunk.tokenCount,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    documentHash: chunk.documentHash,
  };
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new ApiError(422, 'invalid_archive', `The project archive has duplicate ${label} IDs.`);
  }
}

function idMap(values: string[]): Map<string, string> {
  return new Map(values.map((value) => [value, crypto.randomUUID()]));
}

function assertSafeArchivePath(value: string): void {
  const normalized = value.replaceAll('\\', '/');
  const withoutTrailingSlash = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//.test(normalized) ||
    !withoutTrailingSlash ||
    withoutTrailingSlash.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new ApiError(422, 'invalid_archive_path', 'The project archive contains an unsafe path.');
  }
}

function archiveSourcePath(name: string, used: Set<string>): string {
  const basename = path.basename(name).replace(/[^\p{L}\p{N}._ -]/gu, '_') || 'source';
  const extension = path.extname(basename);
  const stem = basename.slice(0, Math.max(0, basename.length - extension.length)) || 'source';
  let suffix = 1;
  let candidate = `sources/${basename}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `sources/${stem}-${suffix}${extension}`;
  }
  used.add(candidate);
  return candidate;
}

function safeSourceExtension(name: string, mediaType: string): string {
  const expected = new Map([
    ['application/pdf', '.pdf'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
    ['text/markdown', '.md'],
    ['text/plain', '.txt'],
  ]).get(mediaType);
  if (!expected) throw new ApiError(422, 'invalid_archive', 'A source media type is unsupported.');
  const supplied = path.extname(path.basename(name)).toLowerCase();
  if (mediaType === 'text/markdown' && supplied === '.markdown') return '.markdown';
  return expected;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readEntryBounded(
  entry: JSZipObject,
  limit: number,
  limitError: ApiError,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const stream = entry.nodeStream('nodebuffer');
    stream.on('data', (value: Buffer | string) => {
      if (settled) return;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      size += chunk.length;
      if (size > limit) {
        settled = true;
        stream.pause();
        reject(limitError);
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', () => {
      if (settled) return;
      settled = true;
      reject(new ApiError(422, 'invalid_archive', 'The project archive is corrupt.'));
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    });
  });
}

function toMarkdown(
  project: Pick<ProjectSummary, 'name' | 'description'>,
  prd: { sections: Array<{ title: string; body: string }> },
): string {
  return [
    `# ${project.name}`,
    project.description,
    ...prd.sections.flatMap((section) => [`## ${section.title}`, section.body]),
    '',
  ]
    .filter((line, index, lines) => line || lines[index - 1] !== '')
    .join('\n\n');
}
