import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import JSZip from 'jszip';
import { config } from '../../src/server/config.js';
import { parseDocument } from '../../src/server/documents/parser.js';

describe('parseDocument', () => {
  it('preserves Markdown headings and structural locations', async () => {
    const parsed = await parseDocument(
      'brief.md',
      Buffer.from('# Problem\n\nCustomers cannot recover drafts.\n\n## Goal\n\nReduce lost work.'),
    );
    expect(parsed.mediaType).toBe('text/markdown');
    expect(parsed.locations.map((location) => location.heading)).toContain('Problem');
    expect(parsed.locations.map((location) => location.heading)).toContain('Goal');
    expect(parsed.locations.map((location) => location.content)).toEqual([
      'Customers cannot recover drafts.',
      'Reduce lost work.',
    ]);
  });

  it('parses plain text paragraphs', async () => {
    const parsed = await parseDocument('notes.txt', Buffer.from('First paragraph.\n\nSecond.'));
    expect(parsed.locations).toHaveLength(2);
    expect(parsed.locations[1]?.locator).toBe('Paragraph 2');
  });

  it('bounds oversized structural locations and labels without losing source text', async () => {
    const content = `${'a'.repeat(2 * 1024 * 1024)}🙂tail`;
    const parsed = await parseDocument('large.txt', Buffer.from(content));
    expect(parsed.locations).toHaveLength(2);
    expect(parsed.locations.every((location) => location.content.length <= 2 * 1024 * 1024)).toBe(
      true,
    );
    expect(parsed.locations.map((location) => location.content).join('')).toBe(content);
    expect(parsed.locations[0]?.locator).toContain('part 1 of 2');
    expect(parsed.locations[1]?.startOffset).toBe(parsed.locations[0]?.endOffset);

    const heading = 'h'.repeat(700);
    const markdown = await parseDocument('large-heading.md', Buffer.from(`# ${heading}\n\nBody.`));
    expect(markdown.locations[0]?.heading).toHaveLength(500);
    expect(markdown.locations[0]?.locator.length).toBeLessThanOrEqual(500);
  });

  it('rejects unsupported, binary, and mismatched files', async () => {
    await expect(parseDocument('legacy.doc', Buffer.from('text'))).rejects.toMatchObject({
      code: 'unsupported_file',
    });
    await expect(parseDocument('fake.txt', Buffer.from([0, 1, 2]))).rejects.toMatchObject({
      code: 'invalid_text',
    });
    await expect(parseDocument('fake.pdf', Buffer.from('not a pdf'))).rejects.toMatchObject({
      code: 'mime_mismatch',
    });
    await expect(parseDocument('unknown.csv', Buffer.from('a,b'))).rejects.toMatchObject({
      code: 'unsupported_file',
    });
    await expect(parseDocument('fake.docx', Buffer.from('not a package'))).rejects.toMatchObject({
      code: 'mime_mismatch',
    });
    const imageSignature = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs1sAAAAASUVORK5CYII=',
      'base64',
    );
    await expect(parseDocument('image.txt', imageSignature)).rejects.toMatchObject({
      code: 'mime_mismatch',
    });
  });

  it('reads PDF pages independently and reports blank pages', async () => {
    const pdf = await PDFDocument.create();
    const first = pdf.addPage();
    first.drawText('First source page');
    const second = pdf.addPage();
    second.drawText('Second source page');
    pdf.addPage();
    const parsed = await parseDocument('source.pdf', Buffer.from(await pdf.save()));
    expect(parsed.locations.map((location) => location.locator)).toEqual(['Page 1', 'Page 2']);
    expect(parsed.partial).toBe(true);
    expect(parsed.warnings[0]).toContain('no extractable text');
  });

  it('parses DOCX headings, paragraphs, lists, and inline formatting', async () => {
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Problem', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({
              children: [new TextRun({ text: 'Drafts ', bold: true }), new TextRun('disappear.')],
            }),
            new Paragraph({ text: 'Recovery', bullet: { level: 0 } }),
          ],
        },
      ],
    });
    const parsed = await parseDocument('brief.docx', await Packer.toBuffer(document));
    expect(parsed.mediaType).toContain('wordprocessingml');
    expect(parsed.locations.some((location) => location.heading === 'Problem')).toBe(true);
  });

  it('rejects a generic ZIP renamed as DOCX', async () => {
    const zip = new JSZip();
    zip.file('notes.txt', 'This is not OOXML.');
    await expect(
      parseDocument('notes.docx', await zip.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toMatchObject({
      code: 'mime_mismatch',
    });
  });

  it('rejects generic ZIP archives renamed as slide or spreadsheet files', async () => {
    const zip = new JSZip();
    zip.file('notes.txt', 'Not an Office document.');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(parseDocument('notes.pptx', buffer)).rejects.toMatchObject({
      code: 'mime_mismatch',
    });
    await expect(parseDocument('notes.xlsx', buffer)).rejects.toMatchObject({
      code: 'mime_mismatch',
    });
  });

  it('rejects DOCX packages whose declared expanded content exceeds the limit', async () => {
    const document = new Document({
      sections: [{ children: [new Paragraph({ text: 'Synthetic content' })] }],
    });
    const buffer = Buffer.from(await Packer.toBuffer(document));
    let changed = 0;
    for (let offset = 0; offset + 46 <= buffer.length; offset += 1) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
      buffer.writeUInt32LE(60 * 1024 * 1024, offset + 24);
      changed += 1;
      if (changed === 2) break;
    }
    expect(changed).toBe(2);
    await expect(parseDocument('oversized.docx', buffer)).rejects.toMatchObject({
      code: 'docx_resource_limit',
    });
  });

  it('enforces configured PDF page and extracted-text limits', async () => {
    const originalPages = config.maxPdfPages;
    const originalTextLimit = config.maxPdfExtractedTextChars;
    try {
      Object.assign(config, { maxPdfPages: 1 });
      const pages = await PDFDocument.create();
      pages.addPage().drawText('First page');
      pages.addPage().drawText('Second page');
      await expect(
        parseDocument('pages.pdf', Buffer.from(await pages.save())),
      ).rejects.toMatchObject({
        code: 'pdf_page_limit',
      });

      Object.assign(config, { maxPdfPages: originalPages, maxPdfExtractedTextChars: 5 });
      const text = await PDFDocument.create();
      text.addPage().drawText('Longer than five characters');
      await expect(parseDocument('text.pdf', Buffer.from(await text.save()))).rejects.toMatchObject(
        {
          code: 'pdf_text_limit',
        },
      );
    } finally {
      Object.assign(config, {
        maxPdfPages: originalPages,
        maxPdfExtractedTextChars: originalTextLimit,
      });
    }
  });

  it('extracts PPTX slide text and reports unread visual content', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('ppt/presentation.xml', '<presentation/>');
    zip.file(
      'ppt/slides/slide1.xml',
      '<p:sp><a:t>Problem</a:t><a:t>Users lose drafts</a:t></p:sp>',
    );
    zip.file('ppt/slides/slide2.xml', '<p:pic/>');
    const parsed = await parseDocument(
      'brief.pptx',
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
    expect(parsed.locations.map((location) => [location.locator, location.content])).toEqual([
      ['Slide 1', 'Problem Users lose drafts'],
    ]);
    expect(parsed.partial).toBe(true);
    expect(parsed.warnings.join(' ')).toContain('Slide 2 contains no extractable text');
    expect(parsed.warnings.join(' ')).toContain('visual or embedded content');
  });

  it('extracts XLSX cells with addresses and flags uncached formulas', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/workbook.xml', '<workbook/>');
    zip.file(
      'xl/sharedStrings.xml',
      '<sst><si><t>Requirement</t></si><si><t>Recover drafts</t></si></sst>',
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="C2"><f>1+1</f></c></row></sheetData></worksheet>',
    );
    const parsed = await parseDocument(
      'requirements.xlsx',
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
    expect(parsed.locations[0]).toMatchObject({
      locator: 'Sheet 1',
      content: 'A1: Requirement | B1: Recover drafts',
    });
    expect(parsed.partial).toBe(true);
    expect(parsed.warnings.join(' ')).toContain('formulas without cached values');
  });

  it.skipIf(process.env.PRD_GENIE_TEST_NATIVE_OCR !== '1')(
    'uses local Vision for JPEG OCR and marks visual interpretation as partial',
    async () => {
      const jpeg = fs.readFileSync(new URL('../fixtures/ocr-sample.jpg', import.meta.url));
      const parsed = await parseDocument('requirements.jpg', jpeg);
      expect(parsed.mediaType).toBe('image/jpeg');
      expect(parsed.partial).toBe(true);
      expect(parsed.locations[0]?.content).toContain('Save draft');
    },
    60_000,
  );

  it('rejects a mismatched JPEG signature', async () => {
    await expect(parseDocument('fake.jpg', Buffer.from('not a jpeg'))).rejects.toMatchObject({
      code: 'mime_mismatch',
    });
  });

  it('explains when packaged JPEG OCR has no bundled helper', async () => {
    const original = process.env.NODE_ENV;
    const originalHelper = process.env.PRD_GENIE_OCR_HELPER;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.PRD_GENIE_OCR_HELPER;
      const jpeg = fs.readFileSync(new URL('../fixtures/ocr-sample.jpg', import.meta.url));
      await expect(parseDocument('requirements.jpeg', jpeg)).rejects.toMatchObject({
        code: 'ocr_unavailable',
      });
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
      if (originalHelper === undefined) delete process.env.PRD_GENIE_OCR_HELPER;
      else process.env.PRD_GENIE_OCR_HELPER = originalHelper;
    }
  });
});
