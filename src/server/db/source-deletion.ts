import { eq } from 'drizzle-orm';
import { ApiError } from '../../shared/api.js';
import type { AppDatabase } from './client.js';
import { drainPendingFileDeletions, enqueueFileDeletion } from './file-deletion.js';
import { sources } from './schema.js';

export function deleteSourceData(database: AppDatabase, projectId: string, sourceId: string): void {
  const source = database.db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!source || source.projectId !== projectId) {
    throw new ApiError(404, 'source_not_found', 'Source not found.');
  }
  const remaining = database.sqlite
    .prepare('SELECT count(*) AS count FROM sources WHERE binary_path = ?')
    .get(source.binaryPath) as { count: number };
  database.sqlite.transaction(() => {
    database.sqlite
      .prepare(
        `UPDATE review_findings
           SET status = 'stale'
           WHERE project_id = ? AND status = 'open'
             AND EXISTS (
               SELECT 1
               FROM json_each(review_findings.citation_ids_json) AS linked
               JOIN citations ON citations.id = linked.value
               WHERE citations.source_id = ?
             )`,
      )
      .run(projectId, sourceId);
    database.sqlite
      .prepare(
        `UPDATE citations
           SET available = 0, unavailability_reason = 'source_deleted'
           WHERE source_id = ?`,
      )
      .run(sourceId);
    if (database.vectorAvailable) {
      const vectorIds = database.sqlite
        .prepare('SELECT id FROM chunks WHERE source_id = ?')
        .all(sourceId) as Array<{ id: string }>;
      const deleteVector = database.sqlite.prepare('DELETE FROM chunk_vectors WHERE chunk_id = ?');
      for (const row of vectorIds) deleteVector.run(row.id);
    }
    database.sqlite
      .prepare(
        'DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE source_id = ?)',
      )
      .run(sourceId);
    database.db.delete(sources).where(eq(sources.id, sourceId)).run();
    if (remaining.count === 1) enqueueFileDeletion(database, source.binaryPath);
  })();
  drainPendingFileDeletions(database);
}
