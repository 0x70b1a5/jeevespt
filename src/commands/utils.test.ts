import { Attachment } from 'discord.js';
import { commandUtils, htmlToReadableText } from './utils';
import { MAX_TEXT_ATTACHMENT_SIZE } from './constants';

const split = (content: string, maxChunkSize?: number, spoiler?: boolean) =>
    commandUtils.splitMessageIntoChunks(
        [{ role: 'assistant', content }],
        maxChunkSize !== undefined ? { maxChunkSize, spoiler } : undefined
    );

describe('splitMessageIntoChunks', () => {
    it('returns short content as a single chunk, unchanged', () => {
        expect(split('Very good, sir.')).toEqual(['Very good, sir.']);
    });

    it('returns no chunks for empty content', () => {
        expect(split('')).toEqual([]);
    });

    it('splits each message separately', () => {
        const chunks = commandUtils.splitMessageIntoChunks([
            { role: 'assistant', content: 'one' },
            { role: 'assistant', content: 'two' }
        ]);
        expect(chunks).toEqual(['one', 'two']);
    });

    it('never exceeds the size cap', () => {
        const content = `${'word '.repeat(200)}\n\n${'a'.repeat(300)}\n${'sentence. '.repeat(50)}`;
        for (const cap of [50, 100, 1800]) {
            for (const chunk of split(content, cap)) {
                expect(chunk.length).toBeLessThanOrEqual(cap);
            }
        }
    });

    it('prefers a paragraph break', () => {
        const chunks = split(`${'a'.repeat(80)}\n\n${'b'.repeat(80)}`, 100);
        expect(chunks).toEqual(['a'.repeat(80), 'b'.repeat(80)]);
    });

    it('falls back to a sentence break', () => {
        const chunks = split(`${'x '.repeat(40)}end. ${'y '.repeat(40)}trail`, 100);
        expect(chunks[0].endsWith('end.')).toBe(true);
        expect(chunks[1].startsWith('y ')).toBe(true);
    });

    it('falls back to a word break and never splits mid-word', () => {
        const chunks = split('alpha '.repeat(100).trim(), 50);
        for (const chunk of chunks) {
            expect(chunk).toMatch(/^alpha( alpha)*$/);
        }
    });

    it('skips a too-early boundary in favor of a fuller chunk', () => {
        // Paragraph break at 10/100 is before the floor; the word tier should win
        const chunks = split(`${'a'.repeat(10)}\n\n${'word '.repeat(30)}`, 100);
        expect(chunks[0].length).toBeGreaterThan(50);
    });

    it('keeps bare URLs intact', () => {
        const url = `https://example.com/${'x'.repeat(40)}`;
        const chunks = split(`${'a '.repeat(30)}${url} ${'b '.repeat(30)}`, 80);
        expect(chunks.some(c => c.includes(url))).toBe(true);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(80);
        }
    });

    it('keeps markdown links intact, even when one straddles the window edge', () => {
        const link = `[a very clickable link](https://example.com/${'p'.repeat(30)})`;
        const chunks = split(`${'w '.repeat(35)}${link} ${'t '.repeat(35)}`, 90);
        expect(chunks.some(c => c.includes(link))).toBe(true);
    });

    it('closes and reopens code fences across chunks', () => {
        const content = `intro\n\`\`\`ts\n${'const x = 1;\n'.repeat(15)}\`\`\`\nafter`;
        const chunks = split(content, 120);
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0].endsWith('```')).toBe(true);
        expect(chunks[1].startsWith('```ts\n')).toBe(true);
        // Every chunk's fences are balanced
        for (const chunk of chunks) {
            const fenceLines = chunk.split('\n').filter(l => /^\s*```/.test(l));
            expect(fenceLines.length % 2).toBe(0);
        }
    });

    it('hard-chops unbroken runs as a last resort', () => {
        const chunks = split('a'.repeat(5000));
        expect(chunks.length).toBe(3);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(1800);
        }
    });

    it('budgets for the spoiler wrapper', () => {
        const chunks = split('a'.repeat(40), 20, true);
        for (const chunk of chunks) {
            expect(chunk).toMatch(/^\|\|a+\|\|$/);
            expect(chunk.length).toBeLessThanOrEqual(20);
        }
    });

    it('preserves all words of fence-free prose', () => {
        const content = `First sentence here. ${'filler '.repeat(120)}Last words remain.`;
        const chunks = split(content, 100);
        const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
        expect(normalize(chunks.join(' '))).toBe(normalize(content));
    });
});

function mockAttachment(partial: { name: string; contentType?: string; size: number }): Attachment {
    return partial as Attachment;
}

describe('isTextFileAttachment', () => {
    it('accepts a Windows battery-report HTML over the old 100KB cap', () => {
        const attachment = mockAttachment({
            name: 'battery-report.html',
            contentType: 'text/html; charset=UTF-8-SIG',
            size: 216333
        });
        expect(commandUtils.isTextLikeAttachment(attachment)).toBe(true);
        expect(commandUtils.isTextFileAttachment(attachment)).toBe(true);
    });

    it('rejects a battery report that exceeds the text size cap', () => {
        const attachment = mockAttachment({
            name: 'battery-report.html',
            contentType: 'text/html; charset=UTF-8-SIG',
            size: MAX_TEXT_ATTACHMENT_SIZE
        });
        expect(commandUtils.isTextLikeAttachment(attachment)).toBe(true);
        expect(commandUtils.isTextFileAttachment(attachment)).toBe(false);
    });

    it('rejects images', () => {
        const attachment = mockAttachment({
            name: 'photo.png',
            contentType: 'image/png',
            size: 50000
        });
        expect(commandUtils.isTextLikeAttachment(attachment)).toBe(false);
        expect(commandUtils.isTextFileAttachment(attachment)).toBe(false);
    });
});

describe('htmlToReadableText', () => {
    it('drops CSS and keeps table cells', () => {
        const html = `<!DOCTYPE html>
<html><head><style>body { font: 12px sans-serif; }</style></head>
<body>
<h1>Battery report</h1>
<table>
<tr><th>START TIME</th><th>STATE</th><th>CAPACITY REMAINING</th></tr>
<tr><td>2026-08-21</td><td>Active</td><td>48 %</td></tr>
</table>
</body></html>`;
        const text = htmlToReadableText(html);
        expect(text).toContain('Battery report');
        expect(text).toContain('START TIME');
        expect(text).toContain('48 %');
        expect(text).not.toContain('font:');
        expect(text).not.toContain('<style');
    });

    it('strips a UTF-8 BOM', () => {
        expect(htmlToReadableText('\uFEFF<p>hello</p>')).toBe('hello');
    });
});

describe('formatTextAttachment', () => {
    it('converts HTML battery reports to readable text', () => {
        const attachment = mockAttachment({
            name: 'battery-report.html',
            contentType: 'text/html; charset=UTF-8-SIG',
            size: 216333
        });
        const formatted = commandUtils.formatTextAttachment(
            attachment,
            '<style>x{}</style><h1>Battery report</h1><p>Design capacity: 45,000 mWh</p>'
        );
        expect(formatted).toContain('Battery report');
        expect(formatted).toContain('Design capacity: 45,000 mWh');
        expect(formatted).not.toContain('<h1>');
    });

    it('leaves plain text unchanged', () => {
        const attachment = mockAttachment({
            name: 'notes.txt',
            contentType: 'text/plain',
            size: 12
        });
        expect(commandUtils.formatTextAttachment(attachment, 'hello world')).toBe('hello world');
    });
});
