CREATE TABLE pending_file_deletions (
  binary_path TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_attempt_at TEXT
);
