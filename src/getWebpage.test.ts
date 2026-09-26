import { waitForStableText, formatPage } from './getWebpage';

describe('waitForStableText', () => {
  const run = async (lengths: number[], opts = { stablePolls: 3, maxPolls: 20 }, resources?: number[]) => {
    let i = 0;
    const read = jest.fn(async () => {
      const n = Math.min(i++, lengths.length - 1);
      return { text: lengths[n], resources: resources ? resources[Math.min(n, resources.length - 1)] : 5 };
    });
    await waitForStableText(read, opts, async () => {});
    return read.mock.calls.length;
  };

  it('returns once the text length holds steady', async () => {
    // grows while rendering, then settles at 900
    expect(await run([0, 120, 480, 900, 900, 900, 900, 900])).toBe(7);
  });

  it('keeps waiting while the page is still changing', async () => {
    expect(await run([100, 100, 200, 200, 200, 200])).toBe(6);
  });

  it('does not treat an empty page as settled', async () => {
    expect(await run([0], { stablePolls: 3, maxPolls: 5 })).toBe(5);
  });

  it('keeps waiting while network requests are still starting', async () => {
    // text unchanged, but the page is still fetching its data
    expect(await run([50, 50, 50, 50, 50, 50, 50], undefined, [1, 2, 3, 4, 4, 4, 4])).toBe(7);
  });

  it('gives up at maxPolls', async () => {
    const growing = Array.from({ length: 50 }, (_, n) => n + 1);
    expect(await run(growing, { stablePolls: 3, maxPolls: 10 })).toBe(10);
  });
});

describe('formatPage', () => {
  it('normalizes whitespace and keeps paragraph breaks', () => {
    const out = formatPage({ title: ' Hi ', url: 'https://x.test/', text: '  a   b \n\n\n\n c\t\td \n' }, 1000);
    expect(out).toBe('Title: Hi\nURL: https://x.test/\n\na b\n\nc d');
  });

  it('marks truncation with the amount cut', () => {
    const out = formatPage({ title: 't', url: 'u', text: 'x'.repeat(30) }, 10);
    expect(out).toContain('x'.repeat(10) + '\n\n[…truncated: 20 more characters]');
  });
});
