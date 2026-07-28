import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ApiError } from '../../shared/api.js';

export interface ParsedLocation {
  id: string;
  locator: string;
  heading: string | null;
  ordinal: number;
  content: string;
  startOffset: number;
  endOffset: number;
}

export interface ParsedDocument {
  mediaType: string;
  locations: ParsedLocation[];
  partial: boolean;
  warnings: string[];
}

const supportedExtensions = new Set(['.pdf', '.docx', '.md', '.markdown', '.txt']);
const rejectedExtensions = new Map([
  ['.doc', 'Legacy Word files are not supported. Save the file as DOCX.'],
  ['.xls', 'Spreadsheets are not supported.'],
  ['.xlsx', 'Spreadsheets are not supported.'],
  ['.ppt', 'Presentations are not supported.'],
  ['.pptx', 'Presentations are not supported.'],
]);

function assertText(buffer: Buffer): string {
  if (buffer.includes(0)) {
    throw new ApiError(415, 'invalid_text', 'The file contains binary data and is not plain text.');
  }
  return buffer.toString('utf8').replaceAll('\r\n', '\n').trim();
}

function structuralTextLocations(text: string, markdown: boolean): ParsedLocation[] {
  const locations: ParsedLocation[] = [];
  const blocks = text.split(/\n{2,}/);
  let offset = 0;
  let currentHeading: string | null = null;
  for (const block of blocks) {
    const start = text.indexOf(block, offset);
    offset = Math.max(start, 0) + block.length;
    const trimmed = block.trim();
    if (!trimmed) continue;
    const headingMatch = markdown ? /^(#{1,6})\s+(.+)$/m.exec(trimmed) : null;
    if (headingMatch?.[2]) currentHeading = headingMatch[2].trim();
    locations.push({
      id: crypto.randomUUID(),
      locator: currentHeading ? `Heading: ${currentHeading}` : `Paragraph ${locations.length + 1}`,
      heading: currentHeading,
      ordinal: locations.length,
      content: trimmed,
      startOffset: Math.max(start, 0),
      endOffset: Math.max(start, 0) + block.length,
    });
  }
  return locations;
}

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  try {
    const task = getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
    });
    const pdf = await task.promise;
    const locations: ParsedLocation[] = [];
    let offset = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const content = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!content) continue;
      locations.push({
        id: crypto.randomUUID(),
        locator: `Page ${pageNumber}`,
        heading: null,
        ordinal: locations.length,
        content,
        startOffset: offset,
        endOffset: offset + content.length,
      });
      offset += content.length + 1;
    }
    await pdf.cleanup();
    return {
      mediaType: 'application/pdf',
      locations,
      partial: locations.length < pdf.numPages,
      warnings:
        locations.length < pdf.numPages ? ['One or more pages contained no extractable text.'] : [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PDF parsing failed.';
    if (/password|encrypted/i.test(message)) {
      throw new ApiError(422, 'encrypted_file', 'Encrypted PDF files are not supported.');
    }
    throw new ApiError(422, 'parse_failed', 'The PDF could not be parsed.');
  }
}

async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  try {
    const converted = await mammoth.convertToHtml({ buffer });
    const content = htmlToMarkdownStructure(converted.value);
    return {
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      locations: structuralTextLocations(content, true),
      partial: converted.messages.some((message) => message.type === 'error'),
      warnings: converted.messages.map((message) => message.message),
    };
  } catch {
    throw new ApiError(422, 'parse_failed', 'The DOCX file could not be parsed.');
  }
}

function htmlToMarkdownStructure(html: string): string {
  return html
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, value: string) => {
      return `\n\n${'#'.repeat(Number.parseInt(level, 10))} ${stripTags(value)}\n\n`;
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, value: string) => `\n- ${stripTags(value)}`)
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}

export async function parseDocument(name: string, buffer: Buffer): Promise<ParsedDocument> {
  const extension = path.extname(name).toLowerCase();
  const rejected = rejectedExtensions.get(extension);
  if (rejected) throw new ApiError(415, 'unsupported_file', rejected);
  if (!supportedExtensions.has(extension)) {
    throw new ApiError(
      415,
      'unsupported_file',
      'Supported source formats are PDF, DOCX, Markdown, and plain text.',
    );
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (extension === '.pdf') {
    if (detected?.mime !== 'application/pdf') {
      throw new ApiError(415, 'mime_mismatch', 'The file signature does not match a PDF.');
    }
    return parsePdf(buffer);
  }
  if (extension === '.docx') {
    const validDocx =
      detected?.mime ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      detected?.mime === 'application/zip';
    if (!validDocx) {
      throw new ApiError(415, 'mime_mismatch', 'The file signature does not match a DOCX file.');
    }
    return parseDocx(buffer);
  }
  if (detected) {
    throw new ApiError(415, 'mime_mismatch', 'The file is binary and cannot be imported as text.');
  }
  const content = assertText(buffer);
  return {
    mediaType: extension === '.txt' ? 'text/plain' : 'text/markdown',
    locations: structuralTextLocations(content, extension !== '.txt'),
    partial: false,
    warnings: [],
  };
}
