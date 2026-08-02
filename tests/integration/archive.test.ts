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

  function addSource(projectId: string, name: string, content: string): void {
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
    database.db
      .insert(chunks)
      .values({
        id: crypto.randomUUID(),
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
  }
});
