import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/server/config.js';
import type { AppDatabase } from '../../src/server/db/client.js';
import { createDatabase } from '../../src/server/db/client.js';
import { Repository } from '../../src/server/db/repository.js';
import { ExportService } from '../../src/server/export/export-service.js';
import { chunks, sourceLocations, sources } from '../../src/server/db/schema.js';

describe('portable project archive restore', () => {
  let database: AppDatabase;
  let repository: Repository;
  let exporter: ExportService;
  let directory: string;
  let originalSourceDir: string;

  beforeEach(() => {
    database = createDatabase(':memory:');
    repository = new Repository(database);
    exporter = new ExportService(repository, database);
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-archive-'));
    originalSourceDir = config.sourceDir;
    Object.assign(config, { sourceDir: directory });
  });

  afterEach(() => {
    Object.assign(config, { sourceDir: originalSourceDir });
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('round trips project revisions and lexical source data with remapped IDs', async () => {
    const project = repository.createProject('Portable project', 'Synthetic archive fixture');
    const prd = repository.getPrd(project.id);
    repository.savePrd(
      project.id,
      0,
      prd.sections.map((section, index) => ({
        ...section,
        body: index === 0 ? 'People lose a synthetic draft.' : section.body,
      })),
      'Seed archive',
    );
    addSource(project.id, 'evidence.markdown', 'Five synthetic participants requested recovery.');
    const archive = await exporter.create(project.id, 'archive');
    const restored = await exporter.restoreArchive(archive.body);
    const restoredAgain = await exporter.restoreArchive(archive.body);

    expect(restored.id).not.toBe(project.id);
    expect(restoredAgain.id).not.toBe(restored.id);
    const restoredPrd = repository.getPrd(restored.id);
    expect(restoredPrd.revision).toBe(1);
    expect(restoredPrd.sections).toContainEqual(
      expect.objectContaining({ body: 'People lose a synthetic draft.' }),
    );
    expect(repository.listRevisions(restored.id)).toHaveLength(2);
    expect(repository.listSources(restored.id)[0]).toMatchObject({
      name: 'evidence.markdown',
      status: 'partial',
    });
    const fts = database.sqlite
      .prepare('SELECT count(*) AS count FROM chunks_fts WHERE project_id = ?')
      .get(restored.id) as { count: number };
    expect(fts.count).toBe(1);

    const zip = await JSZip.loadAsync(archive.body);
    const manifest = await zip.file('project.json')!.async('string');
    expect(manifest).not.toContain(directory);
    expect(manifest).not.toMatch(/api[_-]?key/i);
  });

  it('rejects a source whose bytes do not match the signed manifest hash', async () => {
    const project = repository.createProject('Corrupt archive', '');
    addSource(project.id, 'evidence.txt', 'Original synthetic evidence.');
    const archive = await exporter.create(project.id, 'archive');
    const zip = await JSZip.loadAsync(archive.body);
    zip.file('sources/evidence.txt', 'Tampered synthetic evidence.');
    const tampered = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(exporter.restoreArchive(tampered)).rejects.toMatchObject({
      code: 'archive_hash_mismatch',
    });
  });

  it('restores revision history that contains a section deleted from the current PRD', async () => {
    const project = repository.createProject('Historical sections', '');
    const initial = repository.getPrd(project.id);
    const removed = initial.sections.at(-1)!;
    repository.savePrd(
      project.id,
      initial.revision,
      initial.sections.slice(0, -1).map((section, position) => ({ ...section, position })),
      'Remove one section',
    );
    const archive = await exporter.create(project.id, 'archive');
    const restored = await exporter.restoreArchive(archive.body);
    expect(
      repository.getPrd(restored.id).sections.some((section) => section.title === removed.title),
    ).toBe(false);
    const snapshots = database.sqlite
      .prepare('SELECT snapshot_json AS snapshotJson FROM revisions WHERE project_id = ?')
      .all(restored.id) as Array<{ snapshotJson: string }>;
    expect(snapshots.some((row) => row.snapshotJson.includes(removed.title))).toBe(true);

    const duplicateHistoricalSection = await JSZip.loadAsync(archive.body);
    const duplicateManifest = JSON.parse(
      await duplicateHistoricalSection.file('project.json')!.async('string'),
    ) as { revisions: Array<{ revision: number; snapshot: Array<{ position: number }> }> };
    const historical = duplicateManifest.revisions.find((revision) => revision.revision === 0)!;
    historical.snapshot.push({ ...historical.snapshot[0]!, position: historical.snapshot.length });
    duplicateHistoricalSection.file('project.json', JSON.stringify(duplicateManifest));
    await expect(
      exporter.restoreArchive(
        await duplicateHistoricalSection.generateAsync({ type: 'nodebuffer' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  it('round trips retained citation evidence after its source is deleted', async () => {
    const project = repository.createProject('Deleted source history', '');
    const prd = repository.getPrd(project.id);
    const { sourceId, locationId, chunkId } = addSource(
      project.id,
      'temporary-evidence.txt',
      'Synthetic evidence retained for audit history.',
    );
    const runId = repository.createAiRun({
      projectId: project.id,
      action: 'review',
      scope: 'document',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
    });
    const citationId = repository.storeCitation({
      aiRunId: runId,
      sourceId,
      locationId,
      chunkId,
      sourceName: 'temporary-evidence.txt',
      locator: 'Paragraph 1',
      excerpt: 'Synthetic evidence retained for audit history.',
      evidenceStatus: 'supported',
      available: true,
      unavailabilityReason: null,
    });
    repository.storeFinding({
      aiRunId: runId,
      projectId: project.id,
      category: 'evidence',
      severity: 'warning',
      targetSectionId: prd.sections[0]!.id,
      rationale: 'Keep a durable evidence snapshot.',
      citationIds: [citationId],
      proposedPatch: null,
      sourceRevision: 0,
    });
    repository.completeAiRun(runId, undefined, 'Synthetic review complete.');
    repository.deleteSource(project.id, sourceId);

    const archive = await exporter.create(project.id, 'archive');
    const restored = await exporter.restoreArchive(archive.body);
    expect(repository.listSources(restored.id)).toEqual([]);
    expect(repository.listFindings(restored.id)[0]?.citations).toEqual([
      expect.objectContaining({
        sourceName: 'temporary-evidence.txt',
        excerpt: 'Synthetic evidence retained for audit history.',
        available: false,
        unavailabilityReason: 'source_deleted',
      }),
    ]);
  });

  it('rejects unknown archive files and inconsistent chunk linkages', async () => {
    const project = repository.createProject('Strict archive', '');
    addSource(project.id, 'first.txt', 'First synthetic source.');
    addSource(project.id, 'second.txt', 'Second synthetic source.');
    const archive = await exporter.create(project.id, 'archive');

    const extraZip = await JSZip.loadAsync(archive.body);
    extraZip.file('unexpected.txt', 'not part of the manifest');
    await expect(
      exporter.restoreArchive(await extraZip.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });

    const linkedZip = await JSZip.loadAsync(archive.body);
    const manifest = JSON.parse(await linkedZip.file('project.json')!.async('string')) as {
      chunks: Array<{ sourceId: string; locationId: string }>;
      sources: Array<{ id: string }>;
      locations: Array<{ id: string; sourceId: string }>;
    };
    const linkedChunk = manifest.chunks[0]!;
    const locationSource = manifest.locations.find(
      (location) => location.id === linkedChunk.locationId,
    )!.sourceId;
    linkedChunk.sourceId = manifest.sources.find((source) => source.id !== locationSource)!.id;
    linkedZip.file('project.json', JSON.stringify(manifest));
    await expect(
      exporter.restoreArchive(await linkedZip.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  it('rejects invalid typed state and a current PRD that diverges from revision history', async () => {
    const project = repository.createProject('Typed archive', '');
    const archive = await exporter.create(project.id, 'archive');

    const invalidProvider = await JSZip.loadAsync(archive.body);
    const invalidProviderManifest = JSON.parse(
      await invalidProvider.file('project.json')!.async('string'),
    ) as { project: { selectedProvider: string | null } };
    invalidProviderManifest.project.selectedProvider = 'untrusted-provider';
    invalidProvider.file('project.json', JSON.stringify(invalidProviderManifest));
    await expect(
      exporter.restoreArchive(await invalidProvider.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });

    const divergent = await JSZip.loadAsync(archive.body);
    const divergentManifest = JSON.parse(await divergent.file('project.json')!.async('string')) as {
      prd: { sections: Array<{ body: string }> };
    };
    divergentManifest.prd.sections[0]!.body = 'State not present in the final revision snapshot.';
    divergent.file('project.json', JSON.stringify(divergentManifest));
    await expect(
      exporter.restoreArchive(await divergent.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  it('rejects AI runs and findings that reference impossible revisions', async () => {
    const project = repository.createProject('Revision-bound archive', '');
    const prd = repository.getPrd(project.id);
    const runId = repository.createAiRun({
      projectId: project.id,
      action: 'review',
      scope: 'document',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
    });
    repository.completeAiRun(runId, undefined, 'Synthetic review summary.');
    repository.storeFinding({
      aiRunId: runId,
      projectId: project.id,
      category: 'evidence',
      severity: 'warning',
      targetSectionId: prd.sections[0]!.id,
      rationale: 'The synthetic claim needs evidence.',
      citationIds: [],
      proposedPatch: {
        sectionId: prd.sections[0]!.id,
        beforeMarkdown: prd.sections[0]!.body,
        afterMarkdown: 'A revised synthetic claim.',
      },
      sourceRevision: 0,
    });
    const archive = await exporter.create(project.id, 'archive');

    const impossibleRun = await JSZip.loadAsync(archive.body);
    const runManifest = JSON.parse(await impossibleRun.file('project.json')!.async('string')) as {
      aiRuns: Array<{ sourceRevision: number; appliedRevision: number | null }>;
    };
    runManifest.aiRuns[0]!.sourceRevision = 999;
    impossibleRun.file('project.json', JSON.stringify(runManifest));
    await expect(
      exporter.restoreArchive(await impossibleRun.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });

    const impossibleFinding = await JSZip.loadAsync(archive.body);
    const findingManifest = JSON.parse(
      await impossibleFinding.file('project.json')!.async('string'),
    ) as { findings: Array<{ sourceRevision: number }> };
    findingManifest.findings[0]!.sourceRevision = 999;
    impossibleFinding.file('project.json', JSON.stringify(findingManifest));
    await expect(
      exporter.restoreArchive(await impossibleFinding.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });

    const impossibleApplication = await JSZip.loadAsync(archive.body);
    const applicationManifest = JSON.parse(
      await impossibleApplication.file('project.json')!.async('string'),
    ) as { aiRuns: Array<{ appliedRevision: number | null }> };
    applicationManifest.aiRuns[0]!.appliedRevision = 0;
    impossibleApplication.file('project.json', JSON.stringify(applicationManifest));
    await expect(
      exporter.restoreArchive(await impossibleApplication.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });

    const mismatchedPreimage = await JSZip.loadAsync(archive.body);
    const preimageManifest = JSON.parse(
      await mismatchedPreimage.file('project.json')!.async('string'),
    ) as { findings: Array<{ proposedPatch: { beforeMarkdown: string } | null }> };
    preimageManifest.findings[0]!.proposedPatch!.beforeMarkdown = 'Forged preimage.';
    mismatchedPreimage.file('project.json', JSON.stringify(preimageManifest));
    await expect(
      exporter.restoreArchive(await mismatchedPreimage.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  it('round trips an applied rewrite and can restore its restored archive again', async () => {
    const { archive } = await createAppliedRewriteArchive('Applied rewrite');
    const restored = await exporter.restoreArchive(archive.body);
    expect(repository.listAiRuns(restored.id)[0]).toMatchObject({
      action: 'rewrite',
      status: 'completed',
      sourceRevision: 0,
      appliedRevision: 1,
    });
    const reexported = await exporter.create(restored.id, 'archive');
    const restoredAgain = await exporter.restoreArchive(reexported.body);
    expect(repository.getPrd(restoredAgain.id).revision).toBe(1);
    expect(repository.listAiRuns(restoredAgain.id)[0]?.appliedRevision).toBe(1);

    const revised = await createAppliedRewriteArchive('Revised applied rewrite', true);
    const revisedRestored = await exporter.restoreArchive(revised.archive.body);
    expect(repository.getPrd(revisedRestored.id).sections[0]?.body).toBe(
      'A user-revised synthetic rewrite.',
    );
  });

  it('remaps document proposal markers across repeated archive restores', async () => {
    const project = repository.createProject('Document marker remap', '');
    const prd = repository.getPrd(project.id);
    const output = prd.sections
      .map(
        (section, index) =>
          `<!-- section:${section.id} -->\n## ${section.title}\nRewritten document body ${index + 1}.`,
      )
      .join('\n\n');
    const runId = repository.createAiRun({
      projectId: project.id,
      action: 'rewrite',
      scope: 'document',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
    });
    repository.completeAiRun(runId, undefined, output);
    const saved = repository.savePrd(
      project.id,
      0,
      prd.sections.map((section, index) => ({
        ...section,
        body: `Rewritten document body ${index + 1}.`,
      })),
      `AI run ${runId} accepted`,
    );
    repository.markAiRunApplied(project.id, runId, saved.revision);

    const firstRestore = await exporter.restoreArchive(
      (await exporter.create(project.id, 'archive')).body,
    );
    const secondRestore = await exporter.restoreArchive(
      (await exporter.create(firstRestore.id, 'archive')).body,
    );
    expect(repository.getPrd(secondRestore.id).sections[0]?.body).toBe(
      'Rewritten document body 1.',
    );
  });

  it('round trips a stale historical finding and rejects a forged earlier source snapshot', async () => {
    const project = repository.createProject('Historical finding', '');
    const initial = repository.getPrd(project.id);
    const addedSection = {
      id: crypto.randomUUID(),
      projectId: project.id,
      title: 'Synthetic later section',
      body: 'This section was introduced in revision one.',
      position: initial.sections.length,
      updatedAt: new Date().toISOString(),
    };
    const revisionOne = repository.savePrd(
      project.id,
      0,
      [...initial.sections, addedSection],
      'Add later section',
    );
    const runId = repository.createAiRun({
      projectId: project.id,
      action: 'review',
      scope: 'document',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 1,
    });
    repository.storeFinding({
      aiRunId: runId,
      projectId: project.id,
      category: 'clarity',
      severity: 'info',
      targetSectionId: addedSection.id,
      rationale: 'Clarify the synthetic later section.',
      citationIds: [],
      proposedPatch: {
        sectionId: addedSection.id,
        beforeMarkdown: addedSection.body,
        afterMarkdown: 'This section was clearly introduced in revision one.',
      },
      sourceRevision: 1,
    });
    repository.completeAiRun(runId, undefined, 'Synthetic historical review.');
    repository.savePrd(
      project.id,
      revisionOne.revision,
      revisionOne.sections.map((section, index) =>
        index === 0 ? { ...section, body: 'A later unrelated manual change.' } : section,
      ),
      'Make review historical',
    );
    const archive = await exporter.create(project.id, 'archive');
    const restored = await exporter.restoreArchive(archive.body);
    const restoredFinding = repository.listFindings(restored.id)[0]!;
    expect(restoredFinding).toMatchObject({
      status: 'stale',
      sourceRevision: 1,
    });
    expect(restoredFinding.targetSectionId).not.toBe(addedSection.id);

    const forged = await JSZip.loadAsync(archive.body);
    const manifest = JSON.parse(await forged.file('project.json')!.async('string')) as {
      aiRuns: Array<{ sourceRevision: number }>;
      findings: Array<{ sourceRevision: number }>;
    };
    manifest.aiRuns[0]!.sourceRevision = 0;
    manifest.findings[0]!.sourceRevision = 0;
    forged.file('project.json', JSON.stringify(manifest));
    await expect(
      exporter.restoreArchive(await forged.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  it('round trips an accepted finding and rejects unrelated application provenance', async () => {
    const project = repository.createProject('Accepted finding', '');
    const prd = repository.getPrd(project.id);
    const target = prd.sections[0]!;
    const runId = repository.createAiRun({
      projectId: project.id,
      action: 'review',
      scope: 'document',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
    });
    const finding = repository.storeFinding({
      aiRunId: runId,
      projectId: project.id,
      category: 'clarity',
      severity: 'warning',
      targetSectionId: target.id,
      rationale: 'Apply a traceable synthetic review patch.',
      citationIds: [],
      proposedPatch: {
        sectionId: target.id,
        beforeMarkdown: target.body,
        afterMarkdown: 'A traceable synthetic review patch.',
      },
      sourceRevision: 0,
    });
    repository.completeAiRun(runId, undefined, 'Synthetic review complete.');
    repository.acceptFinding(project.id, finding.id, 0);
    const archive = await exporter.create(project.id, 'archive');
    const restored = await exporter.restoreArchive(archive.body);
    expect(repository.listFindings(restored.id)[0]?.status).toBe('accepted');
    expect(repository.getPrd(restored.id).sections[0]?.body).toBe(
      'A traceable synthetic review patch.',
    );
    const restoredAgain = await exporter.restoreArchive(
      (await exporter.create(restored.id, 'archive')).body,
    );
    expect(repository.listFindings(restoredAgain.id)[0]?.status).toBe('accepted');

    const unrelated = await JSZip.loadAsync(archive.body);
    const unrelatedManifest = JSON.parse(await unrelated.file('project.json')!.async('string')) as {
      revisions: Array<{ revision: number; reason: string }>;
    };
    unrelatedManifest.revisions.find((revision) => revision.revision === 1)!.reason = 'Manual edit';
    unrelated.file('project.json', JSON.stringify(unrelatedManifest));
    await expect(
      exporter.restoreArchive(await unrelated.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  it('rejects forged applied runs, duplicate applications, and invalid scoped targets', async () => {
    const { archive } = await createAppliedRewriteArchive('Applied validation');

    for (const mutation of [
      (run: Record<string, unknown>) => {
        run.status = 'failed';
      },
      (run: Record<string, unknown>) => {
        run.action = 'ask';
      },
      (run: Record<string, unknown>) => {
        run.outputText = null;
      },
    ]) {
      const zip = await JSZip.loadAsync(archive.body);
      const manifest = JSON.parse(await zip.file('project.json')!.async('string')) as {
        aiRuns: Array<Record<string, unknown>>;
      };
      mutation(manifest.aiRuns[0]!);
      zip.file('project.json', JSON.stringify(manifest));
      await expect(
        exporter.restoreArchive(await zip.generateAsync({ type: 'nodebuffer' })),
      ).rejects.toMatchObject({ code: 'invalid_archive' });
    }

    const unrelatedRevision = await JSZip.loadAsync(archive.body);
    const unrelatedRevisionManifest = JSON.parse(
      await unrelatedRevision.file('project.json')!.async('string'),
    ) as {
      revisions: Array<{ revision: number; reason: string; snapshot: Array<{ body: string }> }>;
    };
    const appliedRevision = unrelatedRevisionManifest.revisions.find(
      (revision) => revision.revision === 1,
    )!;
    appliedRevision.reason = 'Manual edit';
    unrelatedRevision.file('project.json', JSON.stringify(unrelatedRevisionManifest));
    await expect(
      exporter.restoreArchive(await unrelatedRevision.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });

    const unrelatedSnapshot = await JSZip.loadAsync(archive.body);
    const unrelatedSnapshotManifest = JSON.parse(
      await unrelatedSnapshot.file('project.json')!.async('string'),
    ) as { revisions: Array<{ revision: number; snapshot: Array<{ body: string }> }> };
    unrelatedSnapshotManifest.revisions.find(
      (revision) => revision.revision === 1,
    )!.snapshot[0]!.body = 'An unrelated manual result.';
    unrelatedSnapshot.file('project.json', JSON.stringify(unrelatedSnapshotManifest));
    await expect(
      exporter.restoreArchive(await unrelatedSnapshot.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });

    const duplicate = await JSZip.loadAsync(archive.body);
    const duplicateManifest = JSON.parse(await duplicate.file('project.json')!.async('string')) as {
      aiRuns: Array<Record<string, unknown>>;
    };
    duplicateManifest.aiRuns.push({ ...duplicateManifest.aiRuns[0], id: crypto.randomUUID() });
    duplicate.file('project.json', JSON.stringify(duplicateManifest));
    await expect(
      exporter.restoreArchive(await duplicate.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });

    const missingTarget = await JSZip.loadAsync(archive.body);
    const missingTargetManifest = JSON.parse(
      await missingTarget.file('project.json')!.async('string'),
    ) as { aiRuns: Array<{ targetSectionId: string | null }> };
    missingTargetManifest.aiRuns[0]!.targetSectionId = null;
    missingTarget.file('project.json', JSON.stringify(missingTargetManifest));
    await expect(
      exporter.restoreArchive(await missingTarget.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });

    const invalidSelection = await JSZip.loadAsync(archive.body);
    const selectionManifest = JSON.parse(
      await invalidSelection.file('project.json')!.async('string'),
    ) as { aiRuns: Array<{ scope: string; selectionText: string | null }> };
    selectionManifest.aiRuns[0]!.scope = 'selection';
    selectionManifest.aiRuns[0]!.selectionText = 'Text absent from the source snapshot.';
    invalidSelection.file('project.json', JSON.stringify(selectionManifest));
    await expect(
      exporter.restoreArchive(await invalidSelection.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  it('rejects empty, corrupt, unsafe, missing, and malformed archive manifests', async () => {
    await expect(exporter.restoreArchive(Buffer.alloc(0))).rejects.toMatchObject({
      code: 'archive_too_large',
    });
    await expect(exporter.restoreArchive(Buffer.from('not a zip'))).rejects.toMatchObject({
      code: 'invalid_archive',
    });

    const unsafe = new JSZip();
    unsafe.file('/absolute.txt', 'unsafe');
    await expect(
      exporter.restoreArchive(await unsafe.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive_path' });

    const missing = new JSZip();
    missing.file('prd.md', '# Missing manifest');
    await expect(
      exporter.restoreArchive(await missing.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });

    const invalidJson = new JSZip();
    invalidJson.file('project.json', '{');
    await expect(
      exporter.restoreArchive(await invalidJson.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });

    const invalidSchema = new JSZip();
    invalidSchema.file('project.json', '{}');
    await expect(
      exporter.restoreArchive(await invalidSchema.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  it('enforces archive entry, manifest, and expanded-byte limits before restore', async () => {
    const many = new JSZip();
    for (let index = 0; index <= 1000; index += 1) many.file(`entry-${index}.txt`, 'x');
    await expect(
      exporter.restoreArchive(await many.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'archive_entry_limit' });

    const originalManifestLimit = config.maxArchiveManifestBytes;
    const originalArchiveLimit = config.maxArchiveBytes;
    try {
      Object.assign(config, { maxArchiveManifestBytes: 1 });
      const manifest = new JSZip();
      manifest.file('project.json', '{}');
      await expect(
        exporter.restoreArchive(await manifest.generateAsync({ type: 'nodebuffer' })),
      ).rejects.toMatchObject({ code: 'archive_manifest_limit' });

      const expanded = new JSZip();
      expanded.file('project.json', 'x'.repeat(10_000));
      const compressed = await expanded.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      });
      Object.assign(config, {
        maxArchiveManifestBytes: originalManifestLimit,
        maxArchiveBytes: compressed.length + 100,
      });
      await expect(exporter.restoreArchive(compressed)).rejects.toMatchObject({
        code: 'archive_too_large',
      });
    } finally {
      Object.assign(config, {
        maxArchiveManifestBytes: originalManifestLimit,
        maxArchiveBytes: originalArchiveLimit,
      });
    }
  });

  it('rejects missing source entries and duplicate manifest source paths', async () => {
    const project = repository.createProject('Manifest references', '');
    addSource(project.id, 'first.txt', 'First source.');
    addSource(project.id, 'second.txt', 'Second source.');
    const archive = await exporter.create(project.id, 'archive');

    const missingSource = await JSZip.loadAsync(archive.body);
    missingSource.remove('sources/first.txt');
    await expect(
      exporter.restoreArchive(await missingSource.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });

    const duplicate = await JSZip.loadAsync(archive.body);
    const manifest = JSON.parse(await duplicate.file('project.json')!.async('string')) as {
      sources: Array<{ archivePath: string }>;
    };
    manifest.sources[1]!.archivePath = manifest.sources[0]!.archivePath;
    duplicate.file('project.json', JSON.stringify(manifest));
    await expect(
      exporter.restoreArchive(await duplicate.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  async function createAppliedRewriteArchive(name: string, revised = false) {
    const project = repository.createProject(name, '');
    const prd = repository.getPrd(project.id);
    const target = prd.sections[0]!;
    const runId = repository.createAiRun({
      projectId: project.id,
      action: 'rewrite',
      scope: 'section',
      provider: 'ollama',
      model: 'synthetic',
      sourceRevision: 0,
      targetSectionId: target.id,
    });
    repository.completeAiRun(runId, undefined, 'A reviewed synthetic rewrite.');
    const appliedBody = revised
      ? 'A user-revised synthetic rewrite.'
      : 'A reviewed synthetic rewrite.';
    const saved = repository.savePrd(
      project.id,
      0,
      prd.sections.map((section) =>
        section.id === target.id ? { ...section, body: appliedBody } : section,
      ),
      `AI run ${runId} ${revised ? 'revised and accepted' : 'accepted'}`,
    );
    repository.markAiRunApplied(project.id, runId, saved.revision);
    return { project, archive: await exporter.create(project.id, 'archive') };
  }

  function addSource(
    projectId: string,
    name: string,
    content: string,
  ): {
    sourceId: string;
    locationId: string;
    chunkId: string;
  } {
    const binary = Buffer.from(content);
    const hash = createHash('sha256').update(binary).digest('hex');
    const binaryPath = path.join(directory, `${hash}.txt`);
    fs.writeFileSync(binaryPath, binary);
    const sourceId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    database.db
      .insert(sources)
      .values({
        id: sourceId,
        projectId,
        name,
        mediaType: name.endsWith('.markdown') ? 'text/markdown' : 'text/plain',
        size: binary.length,
        hash,
        binaryPath,
        status: 'ready',
        error: null,
        createdAt: new Date().toISOString(),
      })
      .run();
    database.db
      .insert(sourceLocations)
      .values({
        id: locationId,
        sourceId,
        locator: 'Paragraph 1',
        heading: null,
        ordinal: 0,
        content,
        startOffset: 0,
        endOffset: content.length,
      })
      .run();
    const chunkId = crypto.randomUUID();
    database.db
      .insert(chunks)
      .values({
        id: chunkId,
        projectId,
        sourceId,
        locationId,
        ordinal: 0,
        content,
        tokenCount: 8,
        startOffset: 0,
        endOffset: content.length,
        documentHash: hash,
      })
      .run();
    return { sourceId, locationId, chunkId };
  }
});
