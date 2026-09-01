import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { config } from '../config.js';
import { embeddingModel } from '../config.js';
import { drainPendingFileDeletions } from './file-deletion.js';
import * as schema from './schema.js';

function findMigrationPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'drizzle/0000_initial.sql'),
    path.resolve(import.meta.dirname, '../../../drizzle/0000_initial.sql'),
  ];
  const migrationPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!migrationPath) {
    throw new Error('Database migration file is missing.');
  }
  return migrationPath;
}

function migrationFiles(): Array<{ name: string; path: string }> {
  const initialPath = findMigrationPath();
  const directory = path.dirname(initialPath);
  return fs
    .readdirSync(directory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(name))
    .sort()
    .map((name) => ({ name: name.replace(/\.sql$/, ''), path: path.join(directory, name) }));
}

export function createDatabase(databasePath = config.databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const existingDatabase = databasePath !== ':memory:' && fs.existsSync(databasePath);
  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    (
      sqlite.prepare('SELECT name FROM app_migrations ORDER BY name').all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
  const pendingMigrations = migrationFiles().filter((migration) => !applied.has(migration.name));
  if (existingDatabase && pendingMigrations.length > 0) {
    createPreMigrationBackup(sqlite, databasePath, pendingMigrations[0]!.name);
  }
  for (const migration of pendingMigrations) {
    const sql = fs.readFileSync(migration.path, 'utf8');
    sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite
        .prepare('INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)')
        .run(migration.name, new Date().toISOString());
    })();
  }

  let vectorAvailable: boolean;
  try {
    sqliteVec.load(sqlite);
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding FLOAT[${embeddingModel.dimensions}]
      )
    `);
    vectorAvailable = true;
  } catch {
    vectorAvailable = false;
  }

  const database = {
    sqlite,
    db: drizzle(sqlite, { schema }),
    vectorAvailable,
    close: () => sqlite.close(),
  };
  drainPendingFileDeletions(database);
  return database;
}

function createPreMigrationBackup(
  sqlite: Database.Database,
  databasePath: string,
  firstPendingMigration: string,
): void {
  const backupPath = `${databasePath}.pre-${firstPendingMigration}.backup`;
  const expectedMigrations = migrationNames(sqlite);
  const temporaryPath = `${backupPath}.${crypto.randomUUID()}.tmp`;
  try {
    sqlite.prepare('VACUUM INTO ?').run(temporaryPath);
    fs.chmodSync(temporaryPath, 0o600);
    if (!validMigrationBackup(temporaryPath, expectedMigrations, firstPendingMigration)) {
      throw new Error('The pre-migration database backup failed integrity validation.');
    }
    // Always replace an earlier sidecar. A previous failed upgrade can leave a valid but stale
    // backup behind, and the user may have written more data before retrying the upgrade.
    fs.renameSync(temporaryPath, backupPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function migrationNames(sqlite: Database.Database): string[] {
  return (
    sqlite.prepare('SELECT name FROM app_migrations ORDER BY name').all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function validMigrationBackup(
  backupPath: string,
  expectedMigrations: string[],
  firstPendingMigration: string,
): boolean {
  let backup: Database.Database | undefined;
  try {
    backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    const integrity = backup.prepare('PRAGMA quick_check').all() as Array<{ quick_check: string }>;
    const migrations = migrationNames(backup);
    return (
      integrity.length === 1 &&
      integrity[0]?.quick_check === 'ok' &&
      !migrations.includes(firstPendingMigration) &&
      JSON.stringify(migrations) === JSON.stringify(expectedMigrations)
    );
  } catch {
    return false;
  } finally {
    backup?.close();
  }
}

export type AppDatabase = ReturnType<typeof createDatabase>;
