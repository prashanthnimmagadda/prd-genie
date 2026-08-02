import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db/client.js';

describe('database migrations', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('upgrades a 0001 database while preserving citation evidence snapshots', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-migration-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'upgrade.sqlite');
    const legacy = new Database(databasePath);
    legacy.pragma('foreign_keys = ON');
    legacy.exec(fs.readFileSync(path.resolve('drizzle/0000_initial.sql'), 'utf8'));
    legacy.exec(fs.readFileSync(path.resolve('drizzle/0001_revision_bound_proposals.sql'), 'utf8'));
    legacy.exec(
      `CREATE TABLE app_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
       INSERT INTO app_migrations VALUES ('0000_initial', '2026-01-01T00:00:00.000Z');
       INSERT INTO app_migrations VALUES ('0001_revision_bound_proposals', '2026-01-01T00:00:00.000Z');`,
    );

    const projectId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    const chunkId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const citationId = crypto.randomUUID();
    const timestamp = '2026-01-01T00:00:00.000Z';
    legacy
      .prepare(
        `INSERT INTO projects
         (id, name, description, selected_provider, selected_model, created_at, updated_at)
         VALUES (?, 'Migration fixture', '', NULL, NULL, ?, ?)`,
      )
      .run(projectId, timestamp, timestamp);
    legacy
      .prepare(
        `INSERT INTO sources
         (id, project_id, name, media_type, size, hash, binary_path, status, error, created_at)
         VALUES (?, ?, 'evidence.txt', 'text/plain', 8, ?, ?, 'ready', NULL, ?)`,
      )
      .run(sourceId, projectId, 'a'.repeat(64), path.join(directory, 'source.txt'), timestamp);
    legacy
      .prepare(
        `INSERT INTO source_locations
         (id, source_id, locator, heading, ordinal, content, start_offset, end_offset)
         VALUES (?, ?, 'Paragraph 1', NULL, 0, 'Evidence', 0, 8)`,
      )
      .run(locationId, sourceId);
    legacy
      .prepare(
        `INSERT INTO chunks
         (id, project_id, source_id, location_id, ordinal, content, token_count,
          start_offset, end_offset, document_hash)
         VALUES (?, ?, ?, ?, 0, 'Evidence', 2, 0, 8, ?)`,
      )
      .run(chunkId, projectId, sourceId, locationId, 'a'.repeat(64));
    legacy
      .prepare(
        `INSERT INTO ai_runs
         (id, project_id, action, scope, provider, model, source_revision, status,
          error_code, started_at, completed_at)
         VALUES (?, ?, 'ask', 'document', 'ollama', 'synthetic', 0, 'completed', NULL, ?, ?)`,
      )
      .run(runId, projectId, timestamp, timestamp);
    legacy
      .prepare(
        `INSERT INTO citations
         (id, ai_run_id, source_id, location_id, chunk_id, excerpt, evidence_status, created_at)
         VALUES (?, ?, ?, ?, ?, 'Evidence', 'supported', ?)`,
      )
      .run(citationId, runId, sourceId, locationId, chunkId, timestamp);
    legacy.close();

    const upgraded = createDatabase(databasePath);
    try {
      const citation = upgraded.sqlite
        .prepare(
          `SELECT source_name AS sourceName, locator, available
           FROM citations WHERE id = ?`,
        )
        .get(citationId) as { sourceName: string; locator: string; available: number };
      expect(citation).toEqual({
        sourceName: 'evidence.txt',
        locator: 'Paragraph 1',
        available: 1,
      });
      expect(
        upgraded.sqlite
          .prepare("SELECT name FROM app_migrations WHERE name = '0003_chatgpt_handoffs'")
          .get(),
      ).toBeTruthy();
    } finally {
      upgraded.close();
    }
  });
});
