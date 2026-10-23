CREATE TABLE workspace_states (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
