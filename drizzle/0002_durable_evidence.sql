CREATE TABLE citations_new (
  id TEXT PRIMARY KEY,
  ai_run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  location_id TEXT REFERENCES source_locations(id) ON DELETE SET NULL,
  chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,
  locator TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  evidence_status TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  unavailability_reason TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO citations_new (
  id, ai_run_id, source_id, location_id, chunk_id, source_name, locator,
  excerpt, evidence_status, available, unavailability_reason, created_at
)
SELECT citations.id, citations.ai_run_id, citations.source_id, citations.location_id,
       citations.chunk_id, sources.name, source_locations.locator, citations.excerpt,
       citations.evidence_status, 1, NULL, citations.created_at
FROM citations
JOIN sources ON sources.id = citations.source_id
JOIN source_locations ON source_locations.id = citations.location_id;

DROP TABLE citations;
ALTER TABLE citations_new RENAME TO citations;
CREATE INDEX citations_ai_run_idx ON citations(ai_run_id);
