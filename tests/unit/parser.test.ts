import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
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
  });

  it('parses plain text paragraphs', async () => {
    const parsed = await parseDocument('notes.txt', Buffer.from('First paragraph.\n\nSecond.'));
    expect(parsed.locations).toHaveLength(2);
    expect(parsed.locations[1]?.locator).toBe('Paragraph 2');
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
});
