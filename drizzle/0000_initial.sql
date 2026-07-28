PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  selected_provider TEXT,
  selected_model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT NOT NULL,
  binary_path TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, hash)
);

CREATE TABLE IF NOT EXISTS source_locations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  locator TEXT NOT NULL,
  heading TEXT,
  ordinal INTEGER NOT NULL,
  content TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES source_locations(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  document_hash TEXT NOT NULL,
  embedding_model TEXT,
  embedding_revision TEXT,
  embedding_dimensions INTEGER,
  embedding BLOB
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  project_id UNINDEXED,
  content,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS prd_documents (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prd_sections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, position)
);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  reason TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, revision)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  scope TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  ai_run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES source_locations(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  excerpt TEXT NOT NULL,
  evidence_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_findings (
  id TEXT PRIMARY KEY,
  ai_run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  target_section_id TEXT NOT NULL REFERENCES prd_sections(id) ON DELETE CASCADE,
  rationale TEXT NOT NULL,
  citation_ids_json TEXT NOT NULL,
  proposed_patch_json TEXT,
  source_revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sources_project_idx ON sources(project_id);
CREATE INDEX IF NOT EXISTS locations_source_idx ON source_locations(source_id, ordinal);
CREATE INDEX IF NOT EXISTS chunks_project_idx ON chunks(project_id);
CREATE INDEX IF NOT EXISTS chunks_source_idx ON chunks(source_id);
CREATE INDEX IF NOT EXISTS sections_project_idx ON prd_sections(project_id, position);
CREATE INDEX IF NOT EXISTS revisions_project_idx ON revisions(project_id, revision DESC);
CREATE INDEX IF NOT EXISTS findings_project_idx ON review_findings(project_id, status);
