import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/server/config.js';
import { createDatabase, type AppDatabase } from '../../src/server/db/client.js';
import { drainPendingFileDeletions, safeErrorCode } from '../../src/server/db/file-deletion.js';
import { Repository } from '../../src/server/db/repository.js';
import { sources } from '../../src/server/db/schema.js';

describe('durable file deletion outbox', () => {
  const originalSourceDir = config.sourceDir;
  let directory: string;
  let sourceDirectory: string;
  let databasePath: string;
  let database: AppDatabase;
  let repository: Repository;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-file-delete-'));
    sourceDirectory = path.join(directory, 'sources');
    databasePath = path.join(directory, 'project.sqlite');
    fs.mkdirSync(sourceDirectory, { recursive: true });
    Object.assign(config, { sourceDir: sourceDirectory });
    database = createDatabase(databasePath);
    repository = new Repository(database);
  });

  afterEach(() => {
    database.close();
    Object.assign(config, { sourceDir: originalSourceDir });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('retains failed source cleanup for retry and clears an absent file on restart', () => {
    const project = repository.createProject('Retry cleanup', '');
    const binaryPath = path.join(sourceDirectory, 'unexpected-directory');
    fs.mkdirSync(binaryPath);
    const sourceId = insertSource(project.id, binaryPath, 'a');

    repository.deleteSource(project.id, sourceId);
    expect(repository.listSources(project.id)).toEqual([]);
    expect(fs.existsSync(binaryPath)).toBe(true);
    expect(pendingJobs()).toHaveLength(1);
    expect(pendingJobs()[0]?.attempts).toBe(1);
    expect(pendingJobs()[0]?.lastErrorCode).toMatch(/^[A-Z_]+$/);

    fs.rmSync(binaryPath, { recursive: true });
    database.close();
    database = createDatabase(databasePath);
    repository = new Repository(database);
    expect(pendingJobs()).toEqual([]);
  });

  it('deletes only the final shared binary reference', () => {
    const first = repository.createProject('First reference', '');
    const second = repository.createProject('Second reference', '');
    const binaryPath = path.join(sourceDirectory, 'shared.txt');
    fs.writeFileSync(binaryPath, 'shared');
    const firstSource = insertSource(first.id, binaryPath, 'b');
    insertSource(second.id, binaryPath, 'c');

    repository.deleteSource(first.id, firstSource);
    expect(fs.existsSync(binaryPath)).toBe(true);
    expect(pendingJobs()).toEqual([]);
    repository.deleteProject(second.id);
    expect(fs.existsSync(binaryPath)).toBe(false);
    expect(pendingJobs()).toEqual([]);
  });

  it('keeps failed project cleanup jobs and retries each path independently', () => {
    const project = repository.createProject('Multiple binaries', '');
    const removable = path.join(sourceDirectory, 'removable.txt');
    const blocked = path.join(sourceDirectory, 'blocked-directory');
    fs.writeFileSync(removable, 'remove me');
    fs.mkdirSync(blocked);
    insertSource(project.id, removable, 'd');
    insertSource(project.id, blocked, 'e');

    repository.deleteProject(project.id);
    expect(repository.listProjects()).toEqual([]);
    expect(fs.existsSync(removable)).toBe(false);
    expect(fs.existsSync(blocked)).toBe(true);
    expect(pendingJobs()).toHaveLength(1);
    expect(pendingJobs()[0]?.attempts).toBe(1);
    expect(pendingJobs()[0]?.lastErrorCode).toMatch(/^[A-Z_]+$/);

    fs.rmSync(blocked, { recursive: true });
    expect(drainPendingFileDeletions(database)).toBe(0);
    expect(pendingJobs()).toEqual([]);
  });

  it('cancels cleanup for a new reference and never unlinks an unsafe path', () => {
    const project = repository.createProject('Replacement reference', '');
    const binaryPath = path.join(sourceDirectory, 'replacement.txt');
    fs.writeFileSync(binaryPath, 'replacement');
    insertPending(binaryPath);
    insertSource(project.id, binaryPath, 'f');
    expect(drainPendingFileDeletions(database)).toBe(0);
    expect(fs.existsSync(binaryPath)).toBe(true);

    const unsafePath = path.join(directory, 'outside.txt');
    fs.writeFileSync(unsafePath, 'private');
    insertPending(unsafePath);
    expect(drainPendingFileDeletions(database)).toBe(1);
    expect(fs.readFileSync(unsafePath, 'utf8')).toBe('private');
    expect(pendingJobs()).toEqual([{ attempts: 1, lastErrorCode: 'unsafe_path' }]);
  });

  it('redacts malformed and nonstandard filesystem failures', () => {
    const malformedPath = path.join(sourceDirectory, 'malformed.txt');
    const unknownPath = path.join(sourceDirectory, 'unknown.txt');
    insertPending(malformedPath);
    insertPending(unknownPath);
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw Object.assign(new Error('private filesystem detail'), { code: 'bad-code!' });
    });
    try {
      expect(drainPendingFileDeletions(database)).toBe(2);
      expect(pendingJobs()).toEqual([
        { attempts: 1, lastErrorCode: 'filesystem_error' },
        { attempts: 1, lastErrorCode: 'filesystem_error' },
      ]);
      expect(safeErrorCode('private non-error detail')).toBe('filesystem_error');
    } finally {
      unlink.mockRestore();
    }
  });

  function insertSource(projectId: string, binaryPath: string, hashPrefix: string): string {
    const sourceId = crypto.randomUUID();
    database.db
      .insert(sources)
      .values({
        id: sourceId,
        projectId,
        name: path.basename(binaryPath),
        mediaType: 'text/plain',
        size: 1,
        hash: hashPrefix.repeat(64),
        binaryPath,
        status: 'ready',
        error: null,
        createdAt: new Date().toISOString(),
      })
      .run();
    return sourceId;
  }

  function insertPending(binaryPath: string): void {
    database.sqlite
      .prepare(
        `INSERT INTO pending_file_deletions
         (binary_path, created_at, attempts, last_error_code, last_attempt_at)
         VALUES (?, ?, 0, NULL, NULL)`,
      )
      .run(binaryPath, new Date().toISOString());
  }

  function pendingJobs(): Array<{ attempts: number; lastErrorCode: string | null }> {
    return database.sqlite
      .prepare(
        `SELECT attempts, last_error_code AS lastErrorCode
         FROM pending_file_deletions ORDER BY binary_path`,
      )
      .all() as Array<{ attempts: number; lastErrorCode: string | null }>;
  }
});
