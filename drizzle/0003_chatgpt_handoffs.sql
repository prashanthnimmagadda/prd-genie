CREATE TABLE chatgpt_handoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  scope TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_digest TEXT,
  response_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  imported_at TEXT,
  applied_revision INTEGER
);

CREATE INDEX handoffs_project_idx ON chatgpt_handoffs(project_id, created_at DESC);
