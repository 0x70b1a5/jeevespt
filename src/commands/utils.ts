import { Message, TextChannel, Webhook, Collection, Attachment } from 'discord.js';
import { SYS_PREFIX, MAX_CHUNK_SIZE, PERSONAS, ALLOWED_DOMAINS, TEMP_DIR } from './constants';
import { ChunkOptions, CommandUtils } from './types';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { URL } from 'url';
import { promisify } from 'util';
const pipeline = promisify(require('stream').pipeline);

/**
 * Shared utilities for command handlers
 */
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
        const chunks: string[] = [];

        msgs.forEach(msg => {
            let content = msg.content;
            while (content.length > 0) {
                let chunk = content.slice(0, maxSize);
                if (opts.spoiler) {
                    chunk = `||${chunk}||`;
                }
                chunks.push(chunk);
                content = content.slice(maxSize);
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
     * Check if an attachment is a readable text file
     */
    isTextFileAttachment(attachment: Attachment): boolean {
        return (
            attachment.size < 100000 &&
            (
                attachment.contentType?.startsWith('text/') ||
                attachment.contentType?.includes('xml') ||
                attachment.contentType?.includes('svg') ||
                !!attachment.name.match(/\.(txt|md|json|yaml|yml|csv|log|ts|js|py|html|css|tsx|jsx|mdx|rtf|svg|sh|bash|zsh|xml|ini|conf|cfg|env|gitignore|dockerfile)$/i)
            )
        );
    }

    /**
     * Download and read a text file from a URL
     */
    async downloadAndReadTextFile(url: string, filename: string): Promise<string> {
        const safePath = this.createTempFilename(filename);
        await this.downloadFile(url, filename, safePath);
        const content = fs.readFileSync(safePath, 'utf8');
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
