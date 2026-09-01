import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  selectedProvider: text('selected_provider'),
  selectedModel: text('selected_model'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mediaType: text('media_type').notNull(),
    size: integer('size').notNull(),
    hash: text('hash').notNull(),
    binaryPath: text('binary_path').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('sources_project_idx').on(table.projectId),
    uniqueIndex('sources_project_hash_idx').on(table.projectId, table.hash),
  ],
);

export const sourceLocations = sqliteTable(
  'source_locations',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    locator: text('locator').notNull(),
    heading: text('heading'),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
  },
  (table) => [index('locations_source_idx').on(table.sourceId, table.ordinal)],
);

export const chunks = sqliteTable(
  'chunks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => sourceLocations.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    documentHash: text('document_hash').notNull(),
    embeddingModel: text('embedding_model'),
    embeddingRevision: text('embedding_revision'),
    embeddingDimensions: integer('embedding_dimensions'),
    embedding: text('embedding', { mode: 'json' }).$type<number[]>(),
  },
  (table) => [
    index('chunks_project_idx').on(table.projectId),
    index('chunks_source_idx').on(table.sourceId),
  ],
);

export const prdDocuments = sqliteTable('prd_documents', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const prdSections = sqliteTable(
  'prd_sections',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    position: integer('position').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('sections_project_idx').on(table.projectId, table.position),
    uniqueIndex('sections_project_position_idx').on(table.projectId, table.position),
  ],
);

export const revisions = sqliteTable(
  'revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    reason: text('reason').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('revisions_project_idx').on(table.projectId, table.revision),
    uniqueIndex('revisions_project_revision_idx').on(table.projectId, table.revision),
  ],
);

export const aiRuns = sqliteTable('ai_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  scope: text('scope').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  sourceRevision: integer('source_revision').notNull(),
  targetSectionId: text('target_section_id'),
  selectionText: text('selection_text'),
  outputText: text('output_text'),
  appliedRevision: integer('applied_revision'),
  status: text('status').notNull(),
  errorCode: text('error_code'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
});

export const citations = sqliteTable('citations', {
  id: text('id').primaryKey(),
  aiRunId: text('ai_run_id')
    .notNull()
    .references(() => aiRuns.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').references(() => sources.id, { onDelete: 'set null' }),
  locationId: text('location_id').references(() => sourceLocations.id, { onDelete: 'set null' }),
  chunkId: text('chunk_id').references(() => chunks.id, { onDelete: 'set null' }),
  sourceName: text('source_name').notNull(),
  locator: text('locator').notNull(),
  excerpt: text('excerpt').notNull(),
  evidenceStatus: text('evidence_status').notNull(),
  available: integer('available', { mode: 'boolean' }).notNull().default(true),
  unavailabilityReason: text('unavailability_reason'),
  createdAt: text('created_at').notNull(),
});

export const reviewFindings = sqliteTable(
  'review_findings',
  {
    id: text('id').primaryKey(),
    aiRunId: text('ai_run_id')
      .notNull()
      .references(() => aiRuns.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    severity: text('severity').notNull(),
    targetSectionId: text('target_section_id').notNull(),
    rationale: text('rationale').notNull(),
    citationIdsJson: text('citation_ids_json').notNull(),
    proposedPatchJson: text('proposed_patch_json'),
    sourceRevision: integer('source_revision').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('findings_project_idx').on(table.projectId, table.status)],
);

export const chatGptHandoffs = sqliteTable(
  'chatgpt_handoffs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceRevision: integer('source_revision').notNull(),
    action: text('action').notNull(),
    scope: text('scope').notNull(),
    requestDigest: text('request_digest').notNull(),
    requestJson: text('request_json').notNull(),
    responseDigest: text('response_digest'),
    responseJson: text('response_json'),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    importedAt: text('imported_at'),
    appliedRevision: integer('applied_revision'),
    applicationJson: text('application_json'),
    applicationDigest: text('application_digest'),
    appliedAt: text('applied_at'),
    retiredAt: text('retired_at'),
  },
  (table) => [index('handoffs_project_idx').on(table.projectId, table.createdAt)],
);
