import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ApiError } from '../../shared/api.js';
import { config } from '../config.js';

export interface ParsedLocation {
  id: string;
  locator: string;
  heading: string | null;
  ordinal: number;
  content: string;
  startOffset: number;
  endOffset: number;
  startsHeading?: boolean;
}

export interface ParsedDocument {
  mediaType: string;
  locations: ParsedLocation[];
  partial: boolean;
  warnings: string[];
}

const supportedExtensions = new Set(['.pdf', '.docx', '.md', '.markdown', '.txt']);
const maxLocationChars = 2 * 1024 * 1024;
const maxLocationLabelChars = 500;
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
  let pendingHeading = false;
  for (const block of blocks) {
    const start = text.indexOf(block, offset);
    offset = Math.max(start, 0) + block.length;
    const trimmed = block.trim();
    if (!trimmed) continue;
    const headingMatch = markdown ? /^(#{1,6})\s+(.+)$/m.exec(trimmed) : null;
    if (headingMatch?.[2]) {
      currentHeading = boundedLabel(headingMatch[2].trim());
      pendingHeading = true;
      if (trimmed === headingMatch[0]) continue;
    }
    const blockStart = Math.max(start, 0) + Math.max(0, block.indexOf(trimmed));
    const parts = splitBoundedText(trimmed, maxLocationChars);
    const baseLocator = currentHeading
      ? `Heading: ${currentHeading}`
      : `Paragraph ${locations.length + 1}`;
    let partOffset = 0;
    for (const [partIndex, content] of parts.entries()) {
      const partLabel = parts.length > 1 ? ` (part ${partIndex + 1} of ${parts.length})` : '';
      locations.push({
        id: crypto.randomUUID(),
        locator: boundedLabel(`${baseLocator}${partLabel}`),
        heading: currentHeading,
        ordinal: locations.length,
        content,
        startOffset: blockStart + partOffset,
        endOffset: blockStart + partOffset + content.length,
        ...(pendingHeading && partIndex === 0 ? { startsHeading: true } : {}),
      });
      partOffset += content.length;
    }
    pendingHeading = false;
  }
  return locations;
}

function splitBoundedText(value: string, limit: number): string[] {
  if (value.length <= limit) return [value];
  const parts: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(offset + limit, value.length);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1] ?? '')) end -= 1;
    parts.push(value.slice(offset, end));
    offset = end;
  }
  return parts;
}

function boundedLabel(value: string): string {
  if (value.length <= maxLocationLabelChars) return value;
  return `${value.slice(0, maxLocationLabelChars - 3)}...`;
}

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const task = getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
  });
  let pdf: Awaited<typeof task.promise> | undefined;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void task.destroy();
  }, config.pdfParseTimeoutMs);
  try {
    pdf = await task.promise;
    if (pdf.numPages > config.maxPdfPages) {
      throw new ApiError(
        413,
        'pdf_page_limit',
        `PDF files must contain ${config.maxPdfPages} pages or fewer.`,
      );
    }
    const locations: ParsedLocation[] = [];
    let offset = 0;
    let extractedTextChars = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (timedOut) {
        throw new ApiError(408, 'pdf_timeout', 'PDF parsing took too long.');
      }
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const content = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!content) continue;
      extractedTextChars += content.length;
      if (extractedTextChars > config.maxPdfExtractedTextChars) {
        throw new ApiError(
          413,
          'pdf_text_limit',
          `PDF files must contain ${config.maxPdfExtractedTextChars.toLocaleString()} extractable characters or fewer.`,
        );
      }
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
    return {
      mediaType: 'application/pdf',
      locations,
      partial: locations.length < pdf.numPages,
      warnings:
        locations.length < pdf.numPages ? ['One or more pages contained no extractable text.'] : [],
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError(408, 'pdf_timeout', 'PDF parsing took too long.');
    const message = error instanceof Error ? error.message : 'PDF parsing failed.';
    if (/password|encrypted/i.test(message)) {
      throw new ApiError(422, 'encrypted_file', 'Encrypted PDF files are not supported.');
    }
    throw new ApiError(422, 'parse_failed', 'The PDF could not be parsed.');
  } finally {
    clearTimeout(timeout);
    if (pdf) await pdf.cleanup();
    await task.destroy();
  }
}

function inspectDocxOoxml(buffer: Buffer): {
  valid: boolean;
  entryCount: number;
  expandedBytes: number;
} {
  const invalid = { valid: false, entryCount: 0, expandedBytes: 0 };
  if (buffer.length < 22) return invalid;
  const requiredEntries = ['[Content_Types].xml', 'word/document.xml'];
  const names = new Set<string>();
  let entryCount = 0;
  let expandedBytes = 0;
  let endOfCentralDirectory = -1;
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOfCentralDirectory = offset;
      break;
    }
  }
  if (endOfCentralDirectory < 0) return invalid;
  const centralDirectorySize = buffer.readUInt32LE(endOfCentralDirectory + 12);
  let offset = buffer.readUInt32LE(endOfCentralDirectory + 16);
  const centralDirectoryEnd = offset + centralDirectorySize;
  if (centralDirectoryEnd > buffer.length) return invalid;
  while (offset + 46 <= centralDirectoryEnd) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) return invalid;
    if ((buffer.readUInt16LE(offset + 8) & 0x1) !== 0) return invalid;
    const expandedSize = buffer.readUInt32LE(offset + 24);
    if (expandedSize === 0xffffffff) return invalid;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > centralDirectoryEnd) return invalid;
    names.add(buffer.toString('utf8', nameStart, nameEnd));
    entryCount += 1;
    expandedBytes += expandedSize;
    offset = nameEnd + extraLength + commentLength;
  }
  return {
    valid: offset === centralDirectoryEnd && requiredEntries.every((entry) => names.has(entry)),
    entryCount,
    expandedBytes,
  };
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
    const docx = inspectDocxOoxml(buffer);
    const validDocx =
      (detected?.mime ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        detected?.mime === 'application/zip') &&
      docx.valid;
    if (!validDocx) {
      throw new ApiError(415, 'mime_mismatch', 'The file signature does not match a DOCX file.');
    }
    if (
      docx.entryCount > config.maxDocxEntries ||
      docx.expandedBytes > config.maxDocxExpandedBytes
    ) {
      throw new ApiError(413, 'docx_resource_limit', 'The expanded DOCX file is too large.');
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
