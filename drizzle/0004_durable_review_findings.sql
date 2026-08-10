CREATE TABLE review_findings_new (
  id TEXT PRIMARY KEY,
  ai_run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  target_section_id TEXT NOT NULL,
  rationale TEXT NOT NULL,
  citation_ids_json TEXT NOT NULL,
  proposed_patch_json TEXT,
  source_revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO review_findings_new (
  id, ai_run_id, project_id, category, severity, target_section_id, rationale,
  citation_ids_json, proposed_patch_json, source_revision, status, created_at
)
SELECT id, ai_run_id, project_id, category, severity, target_section_id, rationale,
       citation_ids_json, proposed_patch_json, source_revision, status, created_at
FROM review_findings;

DROP TABLE review_findings;
ALTER TABLE review_findings_new RENAME TO review_findings;
CREATE INDEX findings_project_idx ON review_findings(project_id, status);
