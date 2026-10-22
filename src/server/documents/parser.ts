import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileTypeFromBuffer } from 'file-type';
import JSZip from 'jszip';
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

const supportedExtensions = new Set([
  '.pdf',
  '.docx',
  '.md',
  '.markdown',
  '.txt',
  '.pptx',
  '.xlsx',
  '.jpg',
  '.jpeg',
]);
const maxLocationChars = 2 * 1024 * 1024;
const maxLocationLabelChars = 500;
const rejectedExtensions = new Map([
  ['.doc', 'Legacy Word files are not supported. Save the file as DOCX.'],
  ['.xls', 'Legacy spreadsheets are not supported. Save the file as XLSX.'],
  ['.ppt', 'Legacy presentations are not supported. Save the file as PPTX.'],
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
    const unreadablePages: number[] = [];
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
      if (!content) {
        unreadablePages.push(pageNumber);
        continue;
      }
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
      partial: unreadablePages.length > 0,
      warnings: [
        ...(unreadablePages.length > 0
          ? [
              `Page${unreadablePages.length === 1 ? '' : 's'} ${unreadablePages.join(', ')} contained no extractable text; scanned images on those pages were not read.`,
            ]
          : []),
        'Only PDF text was extracted. Images, diagrams, and visual table layout were not read; verify them visually.',
      ],
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

function inspectOoxml(
  buffer: Buffer,
  requiredEntries: string[],
): {
  valid: boolean;
  entryCount: number;
  expandedBytes: number;
} {
  const invalid = { valid: false, entryCount: 0, expandedBytes: 0 };
  if (buffer.length < 22) return invalid;
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

/** ZIP directory sizes are untrusted; count bytes while each entry is inflated. */
async function loadBoundedOoxml(
  buffer: Buffer,
  kind: 'DOCX' | 'PPTX' | 'XLSX',
  requiredEntries: string[],
): Promise<JSZip> {
  const limitCode = kind === 'DOCX' ? 'docx_resource_limit' : 'office_resource_limit';
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new ApiError(422, 'parse_failed', `The ${kind} file could not be parsed.`);
  }
  if (Object.keys(zip.files).length > config.maxDocxEntries) {
    throw new ApiError(413, limitCode, `The expanded ${kind} file is too large.`);
  }
  if (requiredEntries.some((entry) => !zip.file(entry))) {
    throw new ApiError(415, 'mime_mismatch', `The file signature does not match a ${kind} file.`);
  }
  let expandedBytes = 0;
  try {
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      await new Promise<void>((resolve, reject) => {
        const stream = entry.nodeStream('nodebuffer') as NodeJS.ReadableStream & {
          destroy(): void;
        };
        stream.on('data', (chunk: Buffer) => {
          expandedBytes += chunk.length;
          if (expandedBytes > config.maxDocxExpandedBytes) {
            stream.destroy();
            reject(new ApiError(413, limitCode, `The expanded ${kind} file is too large.`));
          }
        });
        stream.on('error', reject);
        stream.on('end', resolve);
      });
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, 'parse_failed', `The ${kind} file could not be parsed.`);
  }
  return zip;
}

function decodeXml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,
    (_whole, entity: string) => {
      if (entity[0] === '#') {
        const codePoint =
          entity[1]?.toLowerCase() === 'x'
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : '';
      }
      return (
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[
          entity.toLowerCase()
        ] ?? ''
      );
    },
  );
}

function xmlValues(xml: string, localName: string): string[] {
  const pattern = new RegExp(
    `<(?:(?:[\\w.-]+):)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${localName}>`,
    'gi',
  );
  return [...xml.matchAll(pattern)].map((match) => decodeXml(match[1] ?? '').trim());
}

function makeLocation(
  locator: string,
  content: string,
  ordinal: number,
  offset: number,
): ParsedLocation {
  return {
    id: crypto.randomUUID(),
    locator,
    heading: locator,
    ordinal,
    content,
    startOffset: offset,
    endOffset: offset + content.length,
  };
}

async function readOfficeZip(
  buffer: Buffer,
  kind: 'PPTX' | 'XLSX',
  required: string[],
): Promise<JSZip> {
  const inspected = inspectOoxml(buffer, ['[Content_Types].xml', ...required]);
  if (!inspected.valid)
    throw new ApiError(415, 'mime_mismatch', `The file signature does not match a ${kind} file.`);
  if (
    inspected.entryCount > config.maxDocxEntries ||
    inspected.expandedBytes > config.maxDocxExpandedBytes
  ) {
    throw new ApiError(413, 'office_resource_limit', `The expanded ${kind} file is too large.`);
  }
  return loadBoundedOoxml(buffer, kind, ['[Content_Types].xml', ...required]);
}

function numberedEntries(
  zip: JSZip,
  pattern: RegExp,
): Array<{ number: number; file: JSZip.JSZipObject }> {
  return Object.values(zip.files)
    .flatMap((file) => {
      const match = pattern.exec(file.name);
      return match && !file.dir ? [{ number: Number(match[1]), file }] : [];
    })
    .sort((a, b) => a.number - b.number);
}

async function parsePptx(buffer: Buffer): Promise<ParsedDocument> {
  const zip = await readOfficeZip(buffer, 'PPTX', ['ppt/presentation.xml']);
  const slides = numberedEntries(zip, /^ppt\/slides\/slide(\d+)\.xml$/);
  if (!slides.length)
    throw new ApiError(422, 'empty_document', 'The presentation contains no slides.');
  const locations: ParsedLocation[] = [];
  const warnings: string[] = [];
  let offset = 0;
  for (const slide of slides) {
    const xml = await slide.file.async('string');
    const content = xmlValues(xml, 't').filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const label = `Slide ${slide.number}`;
    if (!content) warnings.push(`${label} contains no extractable text.`);
    else {
      for (const part of splitBoundedText(content, maxLocationChars)) {
        locations.push(makeLocation(label, part, locations.length, offset));
        offset += part.length + 1;
      }
    }
    if (/<(?:[\w.-]+:)?(?:pic|graphicFrame|oleObj)\b/i.test(xml)) {
      warnings.push(`${label} contains visual or embedded content that was not read.`);
    }
  }
  if (zip.file(/^ppt\/notesSlides\/notesSlide\d+\.xml$/).length) {
    warnings.push('Presenter notes were not read.');
  }
  return {
    mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    locations,
    partial: warnings.length > 0,
    warnings,
  };
}

async function parseXlsx(buffer: Buffer): Promise<ParsedDocument> {
  const zip = await readOfficeZip(buffer, 'XLSX', ['xl/workbook.xml']);
  const sheets = numberedEntries(zip, /^xl\/worksheets\/sheet(\d+)\.xml$/);
  if (!sheets.length)
    throw new ApiError(422, 'empty_document', 'The spreadsheet contains no worksheets.');
  const stringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const sharedStrings = stringsXml
    ? xmlValues(stringsXml, 'si').map((value) => xmlValues(value, 't').join(''))
    : [];
  const locations: ParsedLocation[] = [];
  const warnings: string[] = [];
  let offset = 0;
  for (const sheet of sheets) {
    const xml = await sheet.file.async('string');
    const rows = [...xml.matchAll(/<(?:[\w.-]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?row>/gi)];
    let hasFormulaWithoutValue = false;
    const lines: string[] = [];
    for (const row of rows) {
      const cells: string[] = [];
      for (const cell of (row[1] ?? '').matchAll(
        /<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/gi,
      )) {
        const attributes = cell[1] ?? '';
        const inner = cell[2] ?? '';
        const address = /\br="([^"]+)"/.exec(attributes)?.[1] ?? 'Cell';
        const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
        const raw = xmlValues(inner, 'v')[0];
        const inline = xmlValues(inner, 't').join('');
        const value =
          type === 's'
            ? sharedStrings[Number(raw)]
            : type === 'inlineStr'
              ? inline
              : (raw ?? inline);
        if (/<(?:[\w.-]+:)?f\b/i.test(inner) && !value) hasFormulaWithoutValue = true;
        if (value) cells.push(`${address}: ${value}`);
      }
      if (cells.length) lines.push(cells.join(' | '));
    }
    const label = `Sheet ${sheet.number}`;
    const content = lines.join('\n');
    if (!content) warnings.push(`${label} contains no extractable cell values.`);
    else {
      for (const part of splitBoundedText(content, maxLocationChars)) {
        locations.push(makeLocation(label, part, locations.length, offset));
        offset += part.length + 1;
      }
    }
    if (hasFormulaWithoutValue)
      warnings.push(`${label} has formulas without cached values; those results were not read.`);
  }
  if (zip.file(/^xl\/(?:drawings|charts|media)\//).length)
    warnings.push('Spreadsheet charts or images were not read.');
  return {
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    locations,
    partial: warnings.length > 0,
    warnings,
  };
}

async function recognizeJpeg(buffer: Buffer): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new ApiError(
      422,
      'ocr_unavailable',
      'JPEG text recognition requires macOS Vision on this installation.',
    );
  }
  return new Promise((resolve, reject) => {
    const helper = process.env.PRD_GENIE_OCR_HELPER;
    const developmentSource = path.resolve(process.cwd(), 'scripts/mac/JpegOCR.swift');
    if (!helper && (process.env.NODE_ENV === 'production' || !fs.existsSync(developmentSource))) {
      reject(
        new ApiError(
          422,
          'ocr_unavailable',
          'The local JPEG text recognition helper is unavailable.',
        ),
      );
      return;
    }
    const processHandle = spawn(helper || 'swift', helper ? [] : [developmentSource], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SWIFT_MODULECACHE_PATH: path.join(os.tmpdir(), 'prd-genie-swift-cache'),
        CLANG_MODULE_CACHE_PATH: path.join(os.tmpdir(), 'prd-genie-clang-cache'),
      },
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputBytes = 0;
    const timeout = setTimeout(() => processHandle.kill(), 60_000);
    processHandle.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > config.maxPdfExtractedTextChars) processHandle.kill();
      else output.push(chunk);
    });
    processHandle.stderr.on('data', (chunk: Buffer) => {
      if (errors.reduce((total, part) => total + part.length, 0) < 4096) errors.push(chunk);
    });
    processHandle.on('error', () => {
      clearTimeout(timeout);
      reject(
        new ApiError(422, 'ocr_unavailable', 'macOS Vision text recognition could not start.'),
      );
    });
    processHandle.on('close', (code) => {
      clearTimeout(timeout);
      if (outputBytes > config.maxPdfExtractedTextChars) {
        reject(new ApiError(413, 'ocr_text_limit', 'The image contains too much recognized text.'));
      } else if (code !== 0) {
        reject(
          new ApiError(
            422,
            'ocr_failed',
            'Local text recognition could not read this JPEG. Review the image and try another source format.',
          ),
        );
      } else resolve(Buffer.concat(output).toString('utf8').trim());
    });
    processHandle.stdin.end(buffer);
  });
}

async function parseJpeg(buffer: Buffer): Promise<ParsedDocument> {
  const content = await recognizeJpeg(buffer);
  const warnings = [
    'Only text recognized by local macOS Vision was extracted. Review the image: diagrams, layout and handwriting may be missing or misread.',
  ];
  if (!content) warnings.unshift('No text was recognized in this JPEG image.');
  return {
    mediaType: 'image/jpeg',
    locations: content ? [makeLocation('Image text', content, 0, 0)] : [],
    partial: true,
    warnings,
  };
}

async function parseDocx(buffer: Buffer, zip: JSZip): Promise<ParsedDocument> {
  try {
    const converted = await mammoth.convertToHtml({ buffer });
    const content = htmlToMarkdownStructure(converted.value);
    const warnings = converted.messages.map((message) => message.message);
    if (zip.file(/^word\/media\//).length)
      warnings.push('Embedded images in the DOCX were not read.');
    return {
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      locations: structuralTextLocations(content, true),
      partial: warnings.length > 0,
      warnings,
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
    .replace(/<\/?(?:table|tbody|thead)[^>]*>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(
      /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi,
      (_match, value: string) => ` | ${stripTags(value)}`,
    )
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
      'Supported source formats are PDF, DOCX, PPTX, XLSX, JPEG, Markdown, and plain text.',
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
    const docx = inspectOoxml(buffer, ['[Content_Types].xml', 'word/document.xml']);
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
    const zip = await loadBoundedOoxml(buffer, 'DOCX', [
      '[Content_Types].xml',
      'word/document.xml',
    ]);
    return parseDocx(buffer, zip);
  }
  if (extension === '.pptx' || extension === '.xlsx') {
    if (detected?.mime !== 'application/zip' && !detected?.mime?.includes('openxmlformats')) {
      throw new ApiError(
        415,
        'mime_mismatch',
        `The file signature does not match a ${extension.slice(1).toUpperCase()} file.`,
      );
    }
    return extension === '.pptx' ? parsePptx(buffer) : parseXlsx(buffer);
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    if (detected?.mime !== 'image/jpeg') {
      throw new ApiError(415, 'mime_mismatch', 'The file signature does not match a JPEG image.');
    }
    return parseJpeg(buffer);
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
