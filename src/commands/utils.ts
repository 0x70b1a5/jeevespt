import { Message, TextChannel, Webhook, Collection } from 'discord.js';
import { SYS_PREFIX, MAX_CHUNK_SIZE, PERSONAS } from './constants';
import { ChunkOptions, CommandUtils } from './types';

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
}

// Singleton instance
export const commandUtils = new CommandUtilsImpl();
