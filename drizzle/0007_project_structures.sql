ALTER TABLE projects ADD COLUMN selected_structure_id TEXT;
ALTER TABLE prd_sections ADD COLUMN purpose TEXT NOT NULL DEFAULT '';
ALTER TABLE prd_sections ADD COLUMN required INTEGER NOT NULL DEFAULT 0;

CREATE TABLE structure_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sections_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX structure_templates_project_idx ON structure_templates(project_id);
