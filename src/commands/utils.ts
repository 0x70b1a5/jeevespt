import { Message, TextChannel, TextBasedChannel, Webhook, Collection, Attachment, PermissionFlagsBits } from 'discord.js';
import { SYS_PREFIX, MAX_CHUNK_SIZE, PERSONAS, ALLOWED_DOMAINS, TEMP_DIR, MAX_TEXT_ATTACHMENT_SIZE } from './constants';
import { ChunkOptions, CommandUtils } from './types';
import { BotConfig } from '../state/types';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { URL } from 'url';
import { promisify } from 'util';
const pipeline = promisify(require('stream').pipeline);

/**
 * Type guard to check if a channel supports sending messages and typing indicators
 */
export function isSendableChannel(channel: any): channel is TextBasedChannel & { send: Function; sendTyping: Function } {
    return channel && typeof channel.send === 'function' && typeof channel.sendTyping === 'function';
}

/**
 * Format a Date as a Discord timestamp
 * Styles: t (short time), T (long time), d (short date), D (long date),
 *         f (short date/time - default), F (long date/time), R (relative)
 */
export function discordTimestamp(date: Date, style: 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R' = 'f'): string {
    const unixSeconds = Math.floor(date.getTime() / 1000);
    return `<t:${unixSeconds}:${style}>`;
}

/**
 * Check if a user has admin permissions in a guild
 */
export function isAdmin(message: Message): boolean {
    // DMs are always allowed (no guild permissions to check)
    if (!message.guild || !message.member) {
        return true;
    }
    return message.member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Check if a user can execute a command given current config
 * Returns { allowed: true } or { allowed: false, reason: string }
 */
export function canExecuteCommand(
    message: Message,
    commandName: string,
    config: BotConfig
): { allowed: true } | { allowed: false; reason: string } {
    // If admin mode is disabled, everyone can run commands
    if (!config.adminMode) {
        return { allowed: true };
    }

    // DMs bypass admin mode (no guild concept)
    if (!message.guild) {
        return { allowed: true };
    }

    // Admins can always run commands
    if (isAdmin(message)) {
        return { allowed: true };
    }

    // Check if command is whitelisted for non-admins
    const normalizedCommand = commandName.toLowerCase();
    if (config.commandWhitelist.some(cmd => cmd.toLowerCase() === normalizedCommand)) {
        return { allowed: true };
    }

    return {
        allowed: false,
        reason: `Admin mode is enabled. Only administrators can run \`!${commandName}\`. ` +
            `Whitelisted commands: ${config.commandWhitelist.length > 0 ? config.commandWhitelist.map(c => `\`!${c}\``).join(', ') : 'none'}`
    };
}

/**
 * Strip HTML to readable text. Windows `powercfg /batteryreport` exports are
 * mostly CSS plus tables; this keeps the tables and drops the chrome.
 */
export function htmlToReadableText(html: string): string {
    let text = html.replace(/^\uFEFF/, '');
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/(tr|p|div|h[1-6]|li|table|section)\s*>/gi, '\n');
    text = text.replace(/<\/(td|th)\s*>/gi, '\t');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&nbsp;/gi, ' ');
    text = text.replace(/&amp;/gi, '&');
    text = text.replace(/&lt;/gi, '<');
    text = text.replace(/&gt;/gi, '>');
    text = text.replace(/&quot;/gi, '"');
    text = text.replace(/&#39;|&apos;/gi, "'");
    text = text.replace(/[ \t]+\n/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}

/**
 * Shared utilities for command handlers
 */
// --- Message splitting ---------------------------------------------------
//
// Discord rejects messages over 2000 chars, so long responses are split into
// chunks. Rather than chopping at a fixed width (which severs words, sentences,
// and links), each break point is chosen by cascading through boundary tiers,
// searching backwards from the size cap:
//
//   paragraph break → line break → sentence end → word boundary → hard chop
//
// A tier's boundary is only taken if it lands in the last quarter of the
// window (otherwise chunks get too small) and doesn't fall inside a markdown
// link. Bare URLs need no special case: they contain no whitespace, so no
// tier above the hard chop can land inside one. Code fences are closed at the
// chunk end and reopened (with their language tag) in the next chunk.

const SENTENCE_END = /[.!?…]["')\]]*(?=\s)/g;
const BREAK_TIERS: RegExp[] = [/\n{2,}/g, /\n/g, SENTENCE_END, /[ \t]+/g];
const FENCE_CLOSE = '\n```';

/** Markdown link/image spans (`[title](url)`) — never split inside one. */
function linkSpans(text: string): Array<{ start: number; end: number }> {
    const spans: Array<{ start: number; end: number }> = [];
    for (const m of text.matchAll(/\[[^\]\n]*\]\([^)\n]*\)/g)) {
        spans.push({ start: m.index!, end: m.index! + m[0].length });
    }
    return spans;
}

/** The still-open fence (e.g. '```ts') at the end of `text`, or null if none. */
function openFenceAt(text: string): string | null {
    let open: string | null = null;
    for (const line of text.split('\n')) {
        const m = /^\s*```+\s*(\S*)/.exec(line);
        if (m) open = open === null ? '```' + m[1] : null;
    }
    return open;
}

/**
 * Advance past the whitespace consumed by a break: trailing spaces, then any
 * blank lines — but not the next line's indentation (it may be code).
 */
function skipBreakWhitespace(text: string, i: number): number {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
    while (i < text.length && text[i] === '\n') {
        i++;
        let j = i;
        while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
        if (j < text.length && text[j] === '\n') i = j;
        else break;
    }
    return i;
}

/** Find where to break `text` so the chunk fits in `room` chars. */
function findBreak(text: string, room: number): { end: number; next: number } {
    room = Math.max(1, room);
    const floor = Math.floor(room * 0.75);
    const window = text.slice(0, room + 1);
    // Scan past the window edge so a link straddling it is still recognized
    const spans = linkSpans(text.slice(0, room + 501));
    const inLink = (i: number) => spans.some(s => i > s.start && i < s.end);

    for (const tier of BREAK_TIERS) {
        let best: number | null = null;
        for (const m of window.matchAll(tier)) {
            const end = tier === SENTENCE_END ? m.index! + m[0].length : m.index!;
            if (end > room) break;
            if (end >= floor && !inLink(end)) best = end;
        }
        if (best !== null) {
            return { end: best, next: skipBreakWhitespace(text, best) };
        }
    }

    return { end: room, next: room };
}

/** Split one message's content into Discord-safe pieces of ≤ `budget` chars. */
function splitContent(content: string, budget: number): string[] {
    const pieces: string[] = [];
    let rest = content;
    let carryFence: string | null = null;

    while (rest.length > 0) {
        const prefix = carryFence ? carryFence + '\n' : '';
        const room = budget - prefix.length;

        if (rest.length <= room) {
            pieces.push(prefix + rest.replace(/[ \t\n]+$/, ''));
            break;
        }

        const brk = findBreak(rest, room - FENCE_CLOSE.length);
        let chunk = prefix + rest.slice(0, brk.end).replace(/[ \t\n]+$/, '');
        carryFence = openFenceAt(chunk);
        if (carryFence) {
            chunk += FENCE_CLOSE;
        }
        pieces.push(chunk);
        rest = rest.slice(Math.max(brk.next, 1));
    }

    return pieces.filter(p => p.length > 0);
}

export class CommandUtilsImpl implements CommandUtils {
    private webhookCache: Collection<string, Webhook> = new Collection();
    private defaultChunkOpts: ChunkOptions = {
        maxChunkSize: MAX_CHUNK_SIZE,
        spoiler: false
    };

    async reply(message: Message, content: string): Promise<void> {
        await message.reply(`${SYS_PREFIX}${content}`);
    }

    async replyError(message: Message, error: string): Promise<void> {
        await message.reply(`${SYS_PREFIX}[ERROR] ${error}`);
    }

    splitMessageIntoChunks(
        msgs: { role: string; content: string }[],
        opts: ChunkOptions = this.defaultChunkOpts
    ): string[] {
        const maxSize = opts.maxChunkSize ?? MAX_CHUNK_SIZE;
        // The spoiler wrapper counts against the Discord limit too
        const budget = Math.max(1, maxSize - (opts.spoiler ? 4 : 0));
        const chunks: string[] = [];

        msgs.forEach(msg => {
            for (const piece of splitContent(msg.content, budget)) {
                chunks.push(opts.spoiler ? `||${piece}||` : piece);
            }
        });

        return chunks;
    }

    getChannelIdFromName(message: Message, channelInput: string): string | null {
        if (!message.guild) return null;

        // Check if it's a channel mention (e.g., <#1234567890>)
        const mentionMatch = channelInput.match(/^<#(\d+)>$/);
        if (mentionMatch) {
            const channelId = mentionMatch[1];
            // Verify the channel exists in this guild
            const channel = message.guild.channels.cache.get(channelId);
            return channel ? channelId : null;
        }

        // Remove # if present (for raw text like "#general" or "general")
        const name = channelInput.startsWith('#') ? channelInput.substring(1) : channelInput;

        // Try to find the channel by name
        const channel = message.guild.channels.cache.find(
            c => c.name.toLowerCase() === name.toLowerCase()
        );

        return channel?.id || null;
    }

    async getWebhookForChannel(channel: TextChannel, mode: string): Promise<Webhook | null> {
        try {
            const cacheKey = `${channel.id}_${mode}`;

            // Check cache first
            if (this.webhookCache.has(cacheKey)) {
                return this.webhookCache.get(cacheKey)!;
            }

            // Get persona config
            const persona = PERSONAS[mode] || PERSONAS.jeeves;

            // Try to find existing webhook
            const webhooks = await channel.fetchWebhooks();
            let webhook = webhooks.find(wh => wh.name === `JeevesBot_${mode}`);

            // Create new webhook if not found
            if (!webhook) {
                webhook = await channel.createWebhook({
                    name: `JeevesBot_${mode}`,
                    avatar: persona.avatar,
                    reason: `Webhook for ${persona.name} persona`
                });
                console.log(`🔗 Created webhook for ${mode} mode in ${channel.name}`);
            }

            // Cache the webhook
            this.webhookCache.set(cacheKey, webhook);
            return webhook;
        } catch (error) {
            console.error(`Error managing webhook for ${mode} mode:`, error);
            return null;
        }
    }

    async sendWebhookMessage(
        channel: any,
        content: string,
        mode: string,
        files?: any[]
    ): Promise<void> {
        // Only use webhooks for TextChannels, fallback to regular sends for other types
        if (channel.type === 0) { // TextChannel type
            try {
                const webhook = await this.getWebhookForChannel(channel as TextChannel, mode);
                const persona = PERSONAS[mode] || PERSONAS.jeeves;

                if (webhook) {
                    await webhook.send({
                        content,
                        username: persona.name,
                        avatarURL: persona.avatar,
                        files
                    });
                    return;
                }
            } catch (error) {
                console.error('Error sending webhook message:', error);
            }
        }

        // Fallback to regular message for all other cases
        try {
            if (files && files.length > 0) {
                await channel.send({ content, files });
            } else {
                await channel.send(content);
            }
        } catch (error) {
            console.error('Error sending regular message:', error);
        }
    }

    /**
     * Check if text contains URLs
     */
    hasURLs(text: string): boolean {
        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        return urlRegex.test(text);
    }

    /**
     * Whether the attachment looks like text (by MIME type or filename).
     * Size is not considered — use isTextFileAttachment to also enforce the cap.
     */
    isTextLikeAttachment(attachment: Attachment): boolean {
        return (
            !!attachment.contentType?.startsWith('text/') ||
            !!attachment.contentType?.includes('xml') ||
            !!attachment.contentType?.includes('svg') ||
            !!attachment.name.match(/\.(txt|md|json|yaml|yml|csv|log|ts|js|py|html|css|tsx|jsx|mdx|rtf|svg|sh|bash|zsh|xml|ini|conf|cfg|env|gitignore|dockerfile)$/i)
        );
    }

    /**
     * Check if an attachment is a readable text file under the size cap
     */
    isTextFileAttachment(attachment: Attachment): boolean {
        return this.isTextLikeAttachment(attachment) && attachment.size < MAX_TEXT_ATTACHMENT_SIZE;
    }

    /**
     * Prepare downloaded attachment text for the model. HTML (e.g. Windows
     * `powercfg /batteryreport` exports) is stripped to readable text so CSS
     * and markup don't dominate the prompt.
     */
    formatTextAttachment(attachment: Attachment, content: string): string {
        const type = attachment.contentType || '';
        if (type.includes('html') || /\.html?$/i.test(attachment.name)) {
            return htmlToReadableText(content);
        }
        return content;
    }

    /**
     * Download and read a text file from a URL
     */
    async downloadAndReadTextFile(url: string, filename: string): Promise<string> {
        const safePath = this.createTempFilename(filename);
        await this.downloadFile(url, filename, safePath);
        let content = fs.readFileSync(safePath, 'utf8');
        if (content.charCodeAt(0) === 0xFEFF) {
            content = content.slice(1);
        }
        console.log(`🔍 Read file from ${safePath}: ${content.slice(0, 100)}...`);
        fs.unlinkSync(safePath);
        return content;
    }

    private sanitizeFilename(filename: string): string {
        return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    }

    private createTempFilename(filename: string): string {
        return path.join(TEMP_DIR, this.sanitizeFilename(filename));
    }

    private async downloadFile(url: string, filename: string, destination: string): Promise<void> {
        try {
            console.log(`🔍 Downloading file from ${url} to ${filename}`);

            let parsedUrl: URL;
            try {
                parsedUrl = new URL(url);
            } catch (error) {
                throw new Error('Invalid URL provided');
            }

            if (!ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
                throw new Error(`Domain not allowed: ${parsedUrl.hostname}`);
            }

            if (parsedUrl.protocol !== 'https:') {
                throw new Error('Only HTTPS URLs are allowed');
            }

            const response = await new Promise<any>((resolve, reject) => {
                const req = https.get(url, (res) => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Failed to download: ${res.statusCode} ${res.statusMessage}`));
                        return;
                    }
                    resolve(res);
                }).on('error', reject);

                req.setTimeout(30000, () => {
                    req.destroy();
                    reject(new Error('Download timeout'));
                });
            });

            await pipeline(response, fs.createWriteStream(destination));
            console.log(`🔍 Downloaded file from ${url} to ${destination}`);
        } catch (error) {
            console.error(`❌ Error downloading file ${filename}:`, error);
            throw error;
        }
    }
}

// Singleton instance
export const commandUtils = new CommandUtilsImpl();
