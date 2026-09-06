import { cleanUrlArg, iunctusConfig, shortenCommand, shortenUrl, ShortenError } from './shorten';
import { SYS_PREFIX } from './constants';

const jsonResponse = (status: number, body: any) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe('iunctusConfig', () => {
    it('is null unless both the URL and the key are set', () => {
        expect(iunctusConfig({})).toBeNull();
        expect(iunctusConfig({ IUNCTUS_URL: 'https://s.test' })).toBeNull();
        expect(iunctusConfig({ IUNCTUS_API_KEY: 'iu_x' })).toBeNull();
    });

    it('normalises the base URL', () => {
        expect(iunctusConfig({ IUNCTUS_URL: 's.test/', IUNCTUS_API_KEY: ' iu_x ' }))
            .toEqual({ baseUrl: 'https://s.test', apiKey: 'iu_x' });
        expect(iunctusConfig({ IUNCTUS_URL: 'http://localhost:3007', IUNCTUS_API_KEY: 'k' })!.baseUrl)
            .toBe('http://localhost:3007');
    });
});

describe('cleanUrlArg', () => {
    it('unwraps embed-suppressing brackets and backticks', () => {
        expect(cleanUrlArg('<https://a.b/c>')).toBe('https://a.b/c');
        expect(cleanUrlArg('`https://a.b/c`')).toBe('https://a.b/c');
        expect(cleanUrlArg('  https://a.b/c ')).toBe('https://a.b/c');
        expect(cleanUrlArg(undefined)).toBe('');
    });
});

describe('shortenUrl', () => {
    const config = { baseUrl: 'https://s.test', apiKey: 'iu_secret' };

    it('posts JSON with the bearer token and returns the link', async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            jsonResponse(201, { slug: 'ab12cd', short_url: 'https://s.test/ab12cd', url: 'https://example.com/x', clicks: 0 })
        );
        const result = await shortenUrl(config, 'https://example.com/x', undefined, fetchMock as any);
        expect(result).toEqual({ slug: 'ab12cd', short_url: 'https://s.test/ab12cd', url: 'https://example.com/x' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://s.test/api/links');
        expect(init.method).toBe('POST');
        expect(init.headers.authorization).toBe('Bearer iu_secret');
        expect(JSON.parse(init.body)).toEqual({ url: 'https://example.com/x' });
    });

    it('sends the slug only when given', async () => {
        const fetchMock = jest.fn().mockResolvedValue(jsonResponse(201, { slug: 'docs', short_url: 'https://s.test/docs', url: 'https://e.com' }));
        await shortenUrl(config, 'https://e.com', 'docs', fetchMock as any);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ url: 'https://e.com', slug: 'docs' });
    });

    it("relays the API's error message with its status", async () => {
        const fetchMock = jest.fn().mockResolvedValue(jsonResponse(409, { error: '"docs" is already taken.' }));
        await expect(shortenUrl(config, 'https://e.com', 'docs', fetchMock as any))
            .rejects.toMatchObject({ status: 409, message: '"docs" is already taken.' });
    });

    it('copes with a non-JSON error body', async () => {
        const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('nope'); } });
        await expect(shortenUrl(config, 'https://e.com', undefined, fetchMock as any))
            .rejects.toBeInstanceOf(ShortenError);
    });
});

describe('shortenCommand', () => {
    const env = { ...process.env };
    const realFetch = global.fetch;
    let fetchMock: jest.Mock;
    let message: { reply: jest.Mock };
    const ctx = () => ({ message: message as any, id: 'g1', isDM: false, args: [] as string[] });

    beforeEach(() => {
        process.env.IUNCTUS_URL = 'https://s.test';
        process.env.IUNCTUS_API_KEY = 'iu_secret';
        fetchMock = jest.fn();
        global.fetch = fetchMock as any;
        message = { reply: jest.fn().mockResolvedValue(undefined) };
    });

    afterEach(() => {
        process.env = { ...env };
        global.fetch = realFetch;
    });

    it('has the metadata the help and slash bridge need', () => {
        expect(shortenCommand.names).toEqual(['shorten']);
        expect(shortenCommand.description).toBeTruthy();
        expect(shortenCommand.options!.map(o => [o.name, !!o.required])).toEqual([['url', true], ['slug', false]]);
        expect(shortenCommand.deferred).toBe(true);
    });

    it('replies with the short link', async () => {
        fetchMock.mockResolvedValue(jsonResponse(201, { slug: 'ab12cd', short_url: 'https://s.test/ab12cd', url: 'https://example.com/x' }));
        await shortenCommand.execute({ ...ctx(), args: ['<https://example.com/x>'] }, {} as any);
        expect(message.reply).toHaveBeenCalledWith(`${SYS_PREFIX}https://s.test/ab12cd → <https://example.com/x>`);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ url: 'https://example.com/x' });
    });

    it('passes a custom slug through', async () => {
        fetchMock.mockResolvedValue(jsonResponse(201, { slug: 'docs', short_url: 'https://s.test/docs', url: 'https://example.com/x' }));
        await shortenCommand.execute({ ...ctx(), args: ['https://example.com/x', 'docs'] }, {} as any);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ url: 'https://example.com/x', slug: 'docs' });
    });

    it('shows usage without a URL', async () => {
        await shortenCommand.execute(ctx(), {} as any);
        expect(message.reply.mock.calls[0][0]).toContain('Usage');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('relays validation errors from iunctus', async () => {
        fetchMock.mockResolvedValue(jsonResponse(400, { error: "That doesn't look like a URL." }));
        await shortenCommand.execute({ ...ctx(), args: ['nonsense'] }, {} as any);
        expect(message.reply.mock.calls[0][0]).toBe(`${SYS_PREFIX}[ERROR] That doesn't look like a URL.`);
    });

    it('explains a revoked key', async () => {
        fetchMock.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }));
        await shortenCommand.execute({ ...ctx(), args: ['https://example.com'] }, {} as any);
        expect(message.reply.mock.calls[0][0]).toContain('rejected the API key');
    });

    it('reports network failures', async () => {
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
        await shortenCommand.execute({ ...ctx(), args: ['https://example.com'] }, {} as any);
        expect(message.reply.mock.calls[0][0]).toContain('Could not reach the shortener: ECONNREFUSED');
    });

    it('says so when not configured', async () => {
        delete process.env.IUNCTUS_API_KEY;
        await shortenCommand.execute({ ...ctx(), args: ['https://example.com'] }, {} as any);
        expect(message.reply.mock.calls[0][0]).toContain('not configured');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
