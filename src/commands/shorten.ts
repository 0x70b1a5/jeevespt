import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils } from './utils';

/**
 * !shorten <url> [slug] — create a short link on iunctus (the household link
 * shortener). Talks to its JSON API with a per-user bearer token, so every
 * link the bot makes is owned by whoever's token is in IUNCTUS_API_KEY.
 *
 * Nothing about the shortener's hostname lives here: IUNCTUS_URL says where it
 * is, and the API's own validation messages are relayed verbatim.
 */

export interface IunctusConfig {
    baseUrl: string;
    apiKey: string;
}

export interface ShortenResult {
    slug: string;
    short_url: string;
    url: string;
}

export class ShortenError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'ShortenError';
    }
}

/** Reads IUNCTUS_URL / IUNCTUS_API_KEY; null when either is missing. */
export function iunctusConfig(env: NodeJS.ProcessEnv = process.env): IunctusConfig | null {
    const apiKey = env.IUNCTUS_API_KEY?.trim();
    let baseUrl = env.IUNCTUS_URL?.trim();
    if (!apiKey || !baseUrl) return null;
    if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `https://${baseUrl}`;
    return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey };
}

/** Strip the `<...>` people wrap links in to suppress embeds, and stray backticks. */
export function cleanUrlArg(raw: string | undefined): string {
    return (raw ?? '').trim().replace(/^<(.*)>$/, '$1').replace(/^`(.*)`$/, '$1').trim();
}

export async function shortenUrl(
    { baseUrl, apiKey }: IunctusConfig,
    url: string,
    slug?: string,
    fetchImpl: typeof fetch = fetch
): Promise<ShortenResult> {
    const res = await fetchImpl(`${baseUrl}/api/links`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(slug ? { url, slug } : { url })
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message = typeof body?.error === 'string' ? body.error : `iunctus returned HTTP ${res.status}.`;
        throw new ShortenError(res.status, message);
    }
    return { slug: body.slug, short_url: body.short_url, url: body.url };
}

export const shortenCommand: Command = {
    names: ['shorten'],
    description: 'Shorten a URL with iunctus.',
    category: 'Links',
    options: [
        { name: 'url', description: 'The link to shorten', type: 'string', required: true },
        { name: 'slug', description: 'Custom slug (letters, digits, - and _)', type: 'string', required: false }
    ],
    examples: ['!shorten https://example.com/some/very/long/path', '!shorten https://example.com/docs docs'],
    deferred: true,
    async execute(ctx: CommandContext, _deps: CommandDependencies) {
        const config = iunctusConfig();
        if (!config) {
            await commandUtils.replyError(ctx.message, 'The link shortener is not configured (IUNCTUS_URL and IUNCTUS_API_KEY).');
            return;
        }

        const url = cleanUrlArg(ctx.args[0]);
        const slug = ctx.args[1]?.trim() || undefined;
        if (!url) {
            await commandUtils.reply(ctx.message, 'Usage: `!shorten <url> [slug]` — returns a short link.');
            return;
        }

        try {
            const result = await shortenUrl(config, url, slug);
            await commandUtils.reply(ctx.message, `${result.short_url} → <${result.url}>`);
        } catch (error: any) {
            if (error instanceof ShortenError) {
                const text = error.status === 401
                    ? 'iunctus rejected the API key. It may have been revoked.'
                    : error.message;
                await commandUtils.replyError(ctx.message, text);
                return;
            }
            console.error('shorten error:', error);
            await commandUtils.replyError(ctx.message, `Could not reach the shortener: ${error?.message ?? error}`);
        }
    }
};

export const shortenCommands: Command[] = [shortenCommand];
