import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { ZipArchive } from 'archiver';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ApiError } from '../../shared/api.js';
import type { PrdDocument, ProjectSummary } from '../../shared/types.js';
import type { AppDatabase } from '../db/client.js';
import type { Repository } from '../db/repository.js';

export interface ExportResult {
  body: Buffer;
  mediaType: string;
  filename: string;
}

export class ExportService {
  constructor(
    private readonly repository: Repository,
    private readonly database: AppDatabase,
  ) {}

  async create(projectId: string, format: string): Promise<ExportResult> {
    const project = this.repository.getProject(projectId);
    const prd = this.repository.getPrd(projectId);
    const slug = filenameSlug(project.name);
    switch (format) {
      case 'markdown':
        return {
          body: Buffer.from(toMarkdown(project, prd)),
          mediaType: 'text/markdown; charset=utf-8',
          filename: `${slug}.md`,
        };
      case 'docx':
        return {
          body: await toDocx(project, prd),
          mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          filename: `${slug}.docx`,
        };
      case 'pdf':
        return {
          body: await toPdf(project, prd),
          mediaType: 'application/pdf',
          filename: `${slug}.pdf`,
        };
      case 'archive':
        return {
          body: await this.toArchive(project, prd),
          mediaType: 'application/zip',
          filename: `${slug}.prdgenie.zip`,
        };
      default:
        throw new ApiError(
          400,
          'unsupported_export',
          'Export format must be markdown, docx, pdf, or archive.',
        );
    }
  }

  private async toArchive(project: ProjectSummary, prd: PrdDocument): Promise<Buffer> {
    const output = new PassThrough();
    const data: Buffer[] = [];
    output.on('data', (chunk: Buffer) => data.push(chunk));
    const complete = new Promise<Buffer>((resolve, reject) => {
      output.on('end', () => resolve(Buffer.concat(data)));
      output.on('error', reject);
    });
    const zip = new ZipArchive({ zlib: { level: 9 } });
    zip.on('error', (error: Error) => output.destroy(error));
    zip.pipe(output);
    zip.append(
      JSON.stringify(
        {
          formatVersion: 1,
          exportedAt: new Date().toISOString(),
          project,
          prd,
          privacy:
            'This archive contains project content and sources. It contains no provider credentials.',
        },
        null,
        2,
      ),
      { name: 'project.json' },
    );
    zip.append(toMarkdown(project, prd), { name: 'prd.md' });
    const sourceRows = this.database.sqlite
      .prepare('SELECT name, binary_path AS binaryPath FROM sources WHERE project_id = ?')
      .all(project.id) as Array<{ name: string; binaryPath: string }>;
    for (const source of sourceRows) {
      if (fs.existsSync(source.binaryPath)) {
        zip.file(source.binaryPath, { name: `sources/${path.basename(source.name)}` });
      }
    }
    await zip.finalize();
    return complete;
  }
}

function toMarkdown(project: ProjectSummary, prd: PrdDocument): string {
  return [
    `# ${project.name}`,
    project.description,
    ...prd.sections.flatMap((section) => [`## ${section.title}`, section.body]),
    '',
  ]
    .filter((line, index, lines) => line || lines[index - 1] !== '')
    .join('\n\n');
}

async function toDocx(project: ProjectSummary, prd: PrdDocument): Promise<Buffer> {
  const children = [
    new Paragraph({ text: project.name, heading: HeadingLevel.TITLE }),
    ...(project.description
      ? [new Paragraph({ children: [new TextRun(project.description)] })]
      : []),
    ...prd.sections.flatMap((section) => [
      new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }),
      ...section.body.split(/\n{2,}/).map(
        (paragraph) =>
          new Paragraph({
            children: [new TextRun(paragraph.replace(/^[-*]\s+/gm, '• '))],
          }),
      ),
    ]),
  ];
  const document = new Document({ sections: [{ children }] });
  return Packer.toBuffer(document);
}

async function toPdf(project: ProjectSummary, prd: PrdDocument): Promise<Buffer> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const size = { width: 612, height: 792 };
  const margin = 54;
  let page = document.addPage([size.width, size.height]);
  let y = size.height - margin;

  const write = (text: string, fontSize: number, heading = false) => {
    const font = heading ? bold : regular;
    const maxWidth = size.width - margin * 2;
    for (const line of wrapPdfText(text, fontSize, maxWidth)) {
      if (y < margin + fontSize) {
        page = document.addPage([size.width, size.height]);
        y = size.height - margin;
      }
      page.drawText(line, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0.11, 0.12, 0.14),
      });
      y -= fontSize * 1.45;
    }
    y -= fontSize * 0.35;
  };

  write(pdfSafe(project.name), 22, true);
  if (project.description) write(pdfSafe(project.description), 10);
  for (const section of prd.sections) {
    write(pdfSafe(section.title), 14, true);
    write(pdfSafe(section.body || 'No content yet.'), 10);
  }
  return Buffer.from(await document.save());
}

function wrapPdfText(text: string, fontSize: number, maxWidth: number): string[] {
  const approximateCharacterWidth = fontSize * 0.52;
  const limit = Math.max(20, Math.floor(maxWidth / approximateCharacterWidth));
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (`${line} ${word}`.trim().length > limit && line) {
        result.push(line);
        line = word;
      } else {
        line = `${line} ${word}`.trim();
      }
    }
    result.push(line);
  }
  return result;
}

function pdfSafe(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\n]/g, (character) => (character === '•' ? '*' : '?'));
}

function filenameSlug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || 'prd'
  );
}
