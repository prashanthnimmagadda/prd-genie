import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, rgb } from 'pdf-lib';
import { ApiError } from '../../shared/api.js';
import type { PrdDocument, ProjectSummary } from '../../shared/types.js';
import type { AppDatabase } from '../db/client.js';
import type { Repository } from '../db/repository.js';
import { ArchiveService } from '../archive/archive-service.js';

const require = createRequire(import.meta.url);
const pdfFontPaths = {
  regular: require.resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'),
  bold: require.resolve('pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf'),
} as const;

export interface ExportResult {
  body: Buffer;
  mediaType: string;
  filename: string;
}

export class ExportService {
  private readonly archives: ArchiveService;

  constructor(
    private readonly repository: Repository,
    private readonly database: AppDatabase,
  ) {
    this.archives = new ArchiveService(repository, database);
  }

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
          body: await this.archives.create(project.id),
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
  restoreArchive(buffer: Buffer): Promise<ProjectSummary> {
    return this.archives.restore(buffer);
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
  document.registerFontkit(fontkit);
  const regular = await document.embedFont(fs.readFileSync(pdfFontPaths.regular), { subset: true });
  const bold = await document.embedFont(fs.readFileSync(pdfFontPaths.bold), { subset: true });
  const size = { width: 612, height: 792 };
  const margin = 54;
  let page = document.addPage([size.width, size.height]);
  let y = size.height - margin;

  const write = (text: string, fontSize: number, heading = false) => {
    const font = heading ? bold : regular;
    assertPdfFontSupportsText(font, text);
    const maxWidth = size.width - margin * 2;
    for (const line of wrapPdfText(text, font, fontSize, maxWidth)) {
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

  write(project.name, 22, true);
  if (project.description) write(project.description, 10);
  for (const section of prd.sections) {
    write(section.title, 14, true);
    write(section.body || 'No content yet.', 10);
  }
  return Buffer.from(await document.save());
}

function wrapPdfText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = `${line} ${word}`.trim();
      if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && line) {
        result.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    result.push(line);
  }
  return result;
}

function assertPdfFontSupportsText(font: PDFFont, text: string): void {
  try {
    font.encodeText(text);
  } catch {
    throw new ApiError(
      422,
      'unsupported_pdf_characters',
      'The PDF export contains characters that the bundled font cannot represent.',
    );
  }
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
