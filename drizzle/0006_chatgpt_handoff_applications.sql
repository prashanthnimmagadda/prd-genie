ALTER TABLE chatgpt_handoffs ADD COLUMN application_json TEXT;
ALTER TABLE chatgpt_handoffs ADD COLUMN application_digest TEXT;
ALTER TABLE chatgpt_handoffs ADD COLUMN applied_at TEXT;
ALTER TABLE chatgpt_handoffs ADD COLUMN retired_at TEXT;

CREATE UNIQUE INDEX handoffs_project_applied_revision_idx
ON chatgpt_handoffs(project_id, applied_revision)
WHERE applied_revision IS NOT NULL;
