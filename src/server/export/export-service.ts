import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
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

type BodyBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph' | 'quote'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; rows: string[][] };

// PRD bodies are Markdown from the editor. Parse their useful document structure once
// so the two rich exports do not expose Markdown punctuation as the finished content.
function bodyBlocks(body: string): BodyBlock[] {
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  const blocks: BodyBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? '';
    if (!line) {
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]?.length ?? 1,
        text: plainText(heading[2] ?? ''),
      });
      index += 1;
      continue;
    }
    const table = parseTable(lines, index);
    if (table) {
      blocks.push({ kind: 'table', rows: table.rows });
      index = table.next;
      continue;
    }
    const list = /^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/.exec(lines[index] ?? '');
    if (list) {
      const ordered = Boolean(list[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/.exec(lines[index] ?? '');
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(plainText(item[3] ?? ''));
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    if (line.startsWith('> ')) {
      const quoted: string[] = [];
      while ((lines[index] ?? '').trim().startsWith('> ')) {
        quoted.push((lines[index] ?? '').trim().slice(2));
        index += 1;
      }
      blocks.push({ kind: 'quote', text: plainText(quoted.join(' ')) });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? '').trim()) {
      if (
        paragraph.length &&
        (/^#{1,6}\s/.test(lines[index] ?? '') ||
          /^\s*(?:[-*+]\s|\d+\.\s|>\s)/.test(lines[index] ?? '') ||
          parseTable(lines, index))
      )
        break;
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: plainText(paragraph.join(' ')) });
  }
  return blocks;
}

function parseTable(lines: string[], start: number): { rows: string[][]; next: number } | null {
  const header = lines[start] ?? '';
  const separator = lines[start + 1] ?? '';
  if (
    !header.includes('|') ||
    !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator)
  )
    return null;
  const rows = [tableCells(header)];
  let next = start + 2;
  while (next < lines.length && (lines[next] ?? '').includes('|') && (lines[next] ?? '').trim()) {
    rows.push(tableCells(lines[next] ?? ''));
    next += 1;
  }
  const width = Math.max(...rows.map((row) => row.length));
  return { rows: rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? '')), next };
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => plainText(cell.trim()));
}

function plainText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, 'Image: $1 ($2)')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/\*([^*]+)\*|_([^_]+)_/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\(.)/g, '$1');
}

async function toDocx(project: ProjectSummary, prd: PrdDocument): Promise<Buffer> {
  // A4 with the existing one-inch margins, in twentieths of a point.
  const pageSize = { width: 11906, height: 16838 };
  const pageMargin = { top: 1440, right: 1440, bottom: 1440, left: 1440 };
  const contentWidth = pageSize.width - pageMargin.left - pageMargin.right;
  const children: Array<Paragraph | Table> = [
    new Paragraph({ text: project.name, heading: HeadingLevel.TITLE, spacing: { after: 180 } }),
  ];
  if (project.description)
    children.push(new Paragraph({ text: project.description, spacing: { after: 240 } }));
  for (const section of prd.sections) {
    children.push(
      new Paragraph({
        text: section.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 120 },
        keepNext: true,
      }),
    );
    if (!section.body.trim()) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: missingSectionText(section.required), italics: true })],
          spacing: { after: 140 },
        }),
      );
      continue;
    }
    for (const block of bodyBlocks(section.body)) {
      if (block.kind === 'heading') {
        children.push(
          new Paragraph({
            text: block.text,
            heading: block.level <= 1 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
            spacing: { before: 220, after: 90 },
            keepNext: true,
          }),
        );
      } else if (block.kind === 'list') {
        block.items.forEach((item, index) =>
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: block.ordered ? `${index + 1}. ${item}` : `• ${item}` }),
              ],
              indent: { left: 360, hanging: 180 },
              spacing: { after: 70 },
            }),
          ),
        );
      } else if (block.kind === 'table') {
        // Explicit grid and cell widths prevent native Word previews from treating
        // the library's placeholder grid columns as the actual table dimensions.
        const columnWidth = Math.floor(contentWidth / (block.rows[0]?.length ?? 1));
        children.push(
          new Table({
            width: { size: contentWidth, type: WidthType.DXA },
            columnWidths: block.rows[0]!.map(() => columnWidth),
            layout: TableLayoutType.FIXED,
            rows: block.rows.map(
              (row, rowIndex) =>
                new TableRow({
                  children: row.map(
                    (cell) =>
                      new TableCell({
                        width: { size: columnWidth, type: WidthType.DXA },
                        children: [
                          new Paragraph({
                            children: [new TextRun({ text: cell, bold: rowIndex === 0 })],
                          }),
                        ],
                        shading: rowIndex === 0 ? { fill: 'E9EEF2' } : undefined,
                        borders: {
                          bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C8D1D8' },
                        },
                      }),
                  ),
                }),
            ),
          }),
        );
      } else {
        children.push(
          new Paragraph({
            text: block.kind === 'quote' ? `“${block.text}”` : block.text,
            spacing: { after: 140 },
            indent: block.kind === 'quote' ? { left: 320 } : undefined,
          }),
        );
      }
    }
  }
  const document = new Document({
    sections: [{ properties: { page: { size: pageSize, margin: pageMargin } }, children }],
  });
  return Packer.toBuffer(document);
}

async function toPdf(project: ProjectSummary, prd: PrdDocument): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const regular = await document.embedFont(fs.readFileSync(pdfFontPaths.regular), { subset: true });
  const bold = await document.embedFont(fs.readFileSync(pdfFontPaths.bold), { subset: true });
  const size = { width: 612, height: 792 };
  const margin = 54;
  const contentWidth = size.width - margin * 2;
  let page = document.addPage([size.width, size.height]);
  let y = size.height - margin;

  const ensureSpace = (height: number) => {
    if (y - height < margin) {
      page = document.addPage([size.width, size.height]);
      y = size.height - margin;
    }
  };
  const write = (
    text: string,
    fontSize: number,
    options: { heading?: boolean; indent?: number; gap?: number; before?: number } = {},
  ) => {
    const font = options.heading ? bold : regular;
    assertPdfFontSupportsText(font, text);
    const indent = options.indent ?? 0;
    const lineHeight = fontSize * 1.45;
    const lines = wrapPdfText(text, font, fontSize, contentWidth - indent);
    if (options.heading) {
      // Keep the whole heading with at least the first line of its content.
      const before = options.before ?? 0;
      ensureSpace(before + lines.length * lineHeight + (options.gap ?? fontSize * 0.45) + 14.5);
      if (y < size.height - margin) y -= before;
    }
    for (const line of lines) {
      ensureSpace(lineHeight);
      page.drawText(line, {
        x: margin + indent,
        y,
        size: fontSize,
        font,
        color: rgb(0.11, 0.12, 0.14),
      });
      y -= lineHeight;
    }
    y -= options.gap ?? fontSize * 0.45;
  };
  const writeTable = (rows: string[][]) => {
    const columns = rows[0]?.length ?? 0;
    if (!columns) return;
    const cellWidth = contentWidth / columns;
    rows.forEach((row, rowIndex) => {
      const font = rowIndex === 0 ? bold : regular;
      const cells = row.map((cell) => {
        assertPdfFontSupportsText(font, cell);
        return wrapPdfText(cell, font, 9, cellWidth - 16);
      });
      const height = Math.max(22, ...cells.map((lines) => lines.length * 13 + 10));
      ensureSpace(height);
      page.drawRectangle({
        x: margin,
        y: y - height + 4,
        width: contentWidth,
        height,
        color: rgb(rowIndex === 0 ? 0.91 : 1, rowIndex === 0 ? 0.94 : 1, rowIndex === 0 ? 0.96 : 1),
      });
      cells.forEach((lines, column) => {
        lines.forEach((line, lineIndex) =>
          page.drawText(line, {
            x: margin + column * cellWidth + 8,
            y: y - 10 - lineIndex * 13,
            size: 9,
            font,
            color: rgb(0.11, 0.12, 0.14),
          }),
        );
        if (column > 0)
          page.drawLine({
            start: { x: margin + column * cellWidth, y: y + 4 },
            end: { x: margin + column * cellWidth, y: y - height + 4 },
            thickness: 0.4,
            color: rgb(0.78, 0.82, 0.85),
          });
      });
      y -= height + 2;
    });
    y -= 9;
  };

  write(project.name, 22, { heading: true, gap: 16 });
  if (project.description) write(project.description, 10, { gap: 15 });
  for (const section of prd.sections) {
    write(section.title, 14, { heading: true, before: 12, gap: 9 });
    if (!section.body.trim()) {
      write(missingSectionText(section.required), 10);
      continue;
    }
    for (const block of bodyBlocks(section.body)) {
      if (block.kind === 'heading') {
        write(block.text, block.level <= 1 ? 12 : 11, { heading: true, before: 6, gap: 7 });
      } else if (block.kind === 'list') {
        block.items.forEach((item, index) =>
          write(`${block.ordered ? `${index + 1}.` : '•'} ${item}`, 10, { indent: 14, gap: 3 }),
        );
        y -= 6;
      } else if (block.kind === 'table') {
        writeTable(block.rows);
      } else {
        write(block.kind === 'quote' ? `“${block.text}”` : block.text, 10, {
          indent: block.kind === 'quote' ? 14 : 0,
        });
      }
    }
  }
  return Buffer.from(await document.save());
}

function missingSectionText(required: boolean | undefined): string {
  return required ? 'Required section: information needed.' : 'No content provided.';
}

function wrapPdfText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.trim().split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) {
        result.push(line);
        line = '';
      }
      // Only an individual token wider than the column may split mid-word.
      for (const character of word) {
        if (font.widthOfTextAtSize(`${line}${character}`, fontSize) > maxWidth && line) {
          result.push(line);
          line = '';
        }
        line += character;
      }
    }
    result.push(line.trimEnd());
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
