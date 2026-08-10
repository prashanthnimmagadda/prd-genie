import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { AppDatabase } from './client.js';

type DeletionDatabase = Pick<AppDatabase, 'sqlite'>;

interface PendingDeletion {
  binaryPath: string;
}

export function enqueueFileDeletion(database: DeletionDatabase, binaryPath: string): void {
  database.sqlite
    .prepare(
      `INSERT INTO pending_file_deletions
       (binary_path, created_at, attempts, last_error_code, last_attempt_at)
       VALUES (?, ?, 0, NULL, NULL)
       ON CONFLICT(binary_path) DO NOTHING`,
    )
    .run(binaryPath, new Date().toISOString());
}

export function drainPendingFileDeletions(database: DeletionDatabase): number {
  const pending = database.sqlite
    .prepare('SELECT binary_path AS binaryPath FROM pending_file_deletions ORDER BY created_at')
    .all() as PendingDeletion[];
  for (const deletion of pending) {
    const references = database.sqlite
      .prepare('SELECT count(*) AS count FROM sources WHERE binary_path = ?')
      .get(deletion.binaryPath) as { count: number };
    if (references.count > 0) {
      clearDeletion(database, deletion.binaryPath);
      continue;
    }
    if (!isWithinSourceDirectory(deletion.binaryPath)) {
      recordFailure(database, deletion.binaryPath, 'unsafe_path');
      continue;
    }
    try {
      fs.unlinkSync(deletion.binaryPath);
      clearDeletion(database, deletion.binaryPath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        clearDeletion(database, deletion.binaryPath);
      } else {
        recordFailure(database, deletion.binaryPath, safeErrorCode(error));
      }
    }
  }
  return (
    database.sqlite.prepare('SELECT count(*) AS count FROM pending_file_deletions').get() as {
      count: number;
    }
  ).count;
}

function clearDeletion(database: DeletionDatabase, binaryPath: string): void {
  database.sqlite
    .prepare('DELETE FROM pending_file_deletions WHERE binary_path = ?')
    .run(binaryPath);
}

function recordFailure(database: DeletionDatabase, binaryPath: string, errorCode: string): void {
  database.sqlite
    .prepare(
      `UPDATE pending_file_deletions
       SET attempts = attempts + 1, last_error_code = ?, last_attempt_at = ?
       WHERE binary_path = ?`,
    )
    .run(errorCode, new Date().toISOString(), binaryPath);
}

function isWithinSourceDirectory(binaryPath: string): boolean {
  const root = `${path.resolve(config.sourceDir)}${path.sep}`;
  return path.resolve(binaryPath).startsWith(root);
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : 'filesystem_error';
  }
  return 'filesystem_error';
}
