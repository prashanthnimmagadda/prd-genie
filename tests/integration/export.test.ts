import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../../src/server/db/client.js';
import { createDatabase } from '../../src/server/db/client.js';
import { Repository } from '../../src/server/db/repository.js';
import { ExportService } from '../../src/server/export/export-service.js';
import { sources } from '../../src/server/db/schema.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('ExportService', () => {
  let database: AppDatabase;
  let repository: Repository;
  let exporter: ExportService;
  let projectId: string;

  beforeEach(() => {
    database = createDatabase(':memory:');
    repository = new Repository(database);
    exporter = new ExportService(repository, database);
    const project = repository.createProject('Recovery PRD', 'Protect in-progress work');
    projectId = project.id;
    const prd = repository.getPrd(project.id);
    repository.savePrd(
      project.id,
      prd.revision,
      prd.sections.map((section, index) => ({
        ...section,
        body: index === 0 ? 'Users lose unsaved drafts.' : section.body,
      })),
      'Fixture content',
    );
  });

  afterEach(() => database.close());

  it('exports Markdown with the document hierarchy', async () => {
    const result = await exporter.create(projectId, 'markdown');
    expect(result.filename).toBe('recovery-prd.md');
    expect(result.body.toString()).toContain('# Recovery PRD');
    expect(result.body.toString()).toContain('## Problem');
  });

  it('exports valid DOCX, PDF, and portable archive signatures', async () => {
    const docx = await exporter.create(projectId, 'docx');
    expect(docx.body.subarray(0, 2).toString()).toBe('PK');
    const pdf = await exporter.create(projectId, 'pdf');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    const archive = await exporter.create(projectId, 'archive');
    expect(archive.body.subarray(0, 2).toString()).toBe('PK');
  });

  it('rejects spreadsheet and unknown export requests', async () => {
    await expect(exporter.create(projectId, 'xlsx')).rejects.toMatchObject({
      code: 'unsupported_export',
    });
  });

  it('sanitises portable filenames and archives existing source binaries', async () => {
    const project = repository.createProject('🔥', '');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-genie-export-source-'));
    const binaryPath = path.join(directory, 'evidence.txt');
    fs.writeFileSync(binaryPath, 'Synthetic source');
    database.db
      .insert(sources)
      .values({
        id: crypto.randomUUID(),
        projectId: project.id,
        name: '../evidence.txt',
        mediaType: 'text/plain',
        size: 16,
        hash: 'c'.repeat(64),
        binaryPath,
        status: 'ready',
        error: null,
        createdAt: new Date().toISOString(),
      })
      .run();
    const markdown = await exporter.create(project.id, 'markdown');
    expect(markdown.filename).toBe('prd.md');
    const archive = await exporter.create(project.id, 'archive');
    expect(archive.body.subarray(0, 2).toString()).toBe('PK');
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('paginates long PDF content and safely substitutes unsupported characters', async () => {
    const project = repository.createProject('Long export', '');
    const prd = repository.getPrd(project.id);
    repository.savePrd(
      project.id,
      0,
      prd.sections.map((section, index) => ({
        ...section,
        body:
          index === 0 ? `${'A measurable requirement '.repeat(600)}\n• supported bullet\ncafé` : '',
      })),
      'Long synthetic fixture',
    );
    const result = await exporter.create(project.id, 'pdf');
    expect(result.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(result.body.length).toBeGreaterThan(1000);
  });
});
