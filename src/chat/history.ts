/**
 * Live chat history: instead of keeping our own guild-wide buffer/log, read the
 * channel itself when it's time to reply. That keeps context per channel,
 * includes messages from before a restart or while we weren't listening, and
 * reflects edits and deletions.
 *
 * What Discord can't give back — voice-note transcripts and the text of
 * attached files — is remembered per message id in an annotation cache when
 * the message first arrives (see CommandHandler.handleMessage).
 */

import dayjs from 'dayjs';
import { Message, TextChannel } from 'discord.js';
import { extractEmbedDataToText, extractForwardedContent } from '../formatMessage';
import { SYS_PREFIX } from '../commands/constants';

const MAX_FETCH_PAGE = 100; // Discord's per-request limit
const MAX_ANNOTATIONS = 1000;
const REPLY_SNIPPET_CHARS = 80;

export interface ChatLine {
    id: string;
    authorId: string;
    /** "username" or "username/Display Name"; persona name for our own lines. */
    authorName: string;
    /** Sent by this bot (directly or through one of its persona webhooks). */
    isSelf: boolean;
    /** Another bot or webhook. */
    isBot: boolean;
    /** The message text, with forwards, embeds and annotations folded in. */
    text: string;
    timestamp: number;
    replyToId?: string;
    /** Message link, for pointing back at it. */
    url: string;
    /** Formatted for the persona model (timestamp + name for others; raw for self). */
    formatted: string;
}

export interface Annotation {
    text: string;
    /** Replace the message text (voice transcript) rather than append to it. */
    replaces: boolean;
}

export class ChannelHistory {
    private annotations = new Map<string, Annotation>();
    private ownWebhookIds = new Set<string>();
    /** Our own messages that aren't conversation (e.g. posted transcripts). */
    private hidden = new Set<string>();
    /** Channels whose webhooks we've already looked up. */
    private webhooksChecked = new Set<string>();

    annotate(messageId: string, annotation: Annotation): void {
        this.annotations.set(messageId, annotation);
        if (this.annotations.size > MAX_ANNOTATIONS) {
            // Maps iterate in insertion order: drop the oldest.
            this.annotations.delete(this.annotations.keys().next().value!);
        }
    }

    /** Leave one of our messages out of chat context. */
    hide(messageId: string): void {
        this.hidden.add(messageId);
        if (this.hidden.size > MAX_ANNOTATIONS) this.hidden.delete(this.hidden.values().next().value!);
    }

    /** Remember a webhook we post through, so its messages read as ours. */
    addOwnWebhook(webhookId: string): void {
        this.ownWebhookIds.add(webhookId);
    }

    /** Whether a user/webhook id is us (for "is this a reply to Jeeves?"). */
    isSelfId(id: string | undefined, botUserId: string | undefined): boolean {
        return !!id && (id === botUserId || this.ownWebhookIds.has(id));
    }

    /**
     * The last `limit` messages in the channel, oldest first, newer than
     * `since` (the persona's context floor).
     */
    async fetch(channel: any, opts: { limit: number; since?: number }): Promise<ChatLine[]> {
        if (!channel?.messages?.fetch) return [];
        const botUserId: string | undefined = channel.client?.user?.id;

        const raw: Message[] = [];
        let before: string | undefined;
        while (raw.length < opts.limit) {
            const page = await channel.messages.fetch({ limit: Math.min(MAX_FETCH_PAGE, opts.limit - raw.length), before });
            const messages: Message[] = [...page.values()];
            if (!messages.length) break;
            raw.push(...messages);
            const oldest = messages[messages.length - 1];
            if (opts.since && oldest.createdTimestamp <= opts.since) break;
            if (messages.length < MAX_FETCH_PAGE) break;
            before = oldest.id;
        }
        raw.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        await this.discoverOwnWebhooks(channel, raw, botUserId);

        const byId = new Map<string, ChatLine>();
        const lines: ChatLine[] = [];
        for (const message of raw) {
            if (opts.since && message.createdTimestamp <= opts.since) continue;
            const line = this.toLine(message, botUserId, byId);
            if (!line) continue;
            byId.set(line.id, line);
            lines.push(line);
        }
        return lines;
    }

    private toLine(message: Message, botUserId: string | undefined, earlier: Map<string, ChatLine>): ChatLine | null {
        if (this.hidden.has(message.id)) return null;
        const isSelf = message.author.id === botUserId || (!!message.webhookId && this.ownWebhookIds.has(message.webhookId));
        const content = message.content ?? '';

        if (isSelf) {
            // Slash-command replies, panels, proposals and [SYSTEM] notices
            // aren't conversation.
            if (!content.trim() || content.startsWith(SYS_PREFIX) || message.interactionMetadata) return null;
        } else if (content.startsWith('!')) {
            return null; // commands
        }

        const annotation = this.annotations.get(message.id);
        let text = annotation?.replaces
            ? annotation.text
            : (message.cleanContent ?? content) + extractForwardedContent(message) + extractEmbedDataToText(message)
                + (annotation ? `\n${annotation.text}` : '');
        if (!annotation && !isSelf) {
            const names = [...(message.attachments?.values() ?? [])].map(a => a.name).filter(Boolean);
            if (names.length) text += `\n(attachments: ${names.join(', ')})`;
        }
        text = text.trim();
        if (!text) return null;

        const displayName = message.member?.displayName;
        const username = message.author.username;
        const authorName = displayName && displayName !== username ? `${username}/${displayName}` : username;
        const isBot = !isSelf && (message.author.bot || !!message.webhookId);

        const replyToId = message.reference?.messageId;
        let formatted: string;
        if (isSelf) {
            formatted = text;
        } else {
            // Same shape as prependTimestampAndUsername: "MM/DD/YYYY HH:mm:ss [user/Display]"
            const header = `${dayjs(message.createdTimestamp).format('MM/DD/YYYY HH:mm:ss')} [${authorName}]`;
            const repliedTo = replyToId ? earlier.get(replyToId) : undefined;
            const replyNote = repliedTo
                ? ` (replying to ${repliedTo.isSelf ? 'you' : repliedTo.authorName}: "${snippet(repliedTo.text)}")`
                : '';
            formatted = `${header}${isBot ? ' [bot]' : ''}${replyNote}: ${text}`;
        }

        return {
            id: message.id,
            authorId: message.author.id,
            authorName,
            isSelf,
            isBot,
            text,
            timestamp: message.createdTimestamp,
            replyToId,
            url: message.url,
            formatted
        };
    }

    /**
     * After a restart we don't know which webhooks are ours until we post.
     * The first time a channel shows an unknown webhook message, look up the
     * channel's webhooks once and claim the ones we created.
     */
    private async discoverOwnWebhooks(channel: any, messages: Message[], botUserId: string | undefined): Promise<void> {
        if (this.webhooksChecked.has(channel.id) || typeof channel.fetchWebhooks !== 'function') return;
        if (!messages.some(m => m.webhookId && !this.ownWebhookIds.has(m.webhookId))) return;
        this.webhooksChecked.add(channel.id);
        try {
            const webhooks = await (channel as TextChannel).fetchWebhooks();
            for (const webhook of webhooks.values()) {
                if (webhook.owner?.id === botUserId || webhook.name?.startsWith('JeevesBot_')) {
                    this.ownWebhookIds.add(webhook.id);
                }
            }
        } catch (error) {
            console.error('Could not look up channel webhooks:', error);
        }
    }
}

export function snippet(text: string, max = REPLY_SNIPPET_CHARS): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Persona-model messages: our lines are the assistant, everyone else a user. */
export function toLlmMessages(lines: ChatLine[]): { role: string; content: string }[] {
    return lines.map(line => ({ role: line.isSelf ? 'assistant' : 'user', content: line.formatted }));
}

/** Shared instance: the annotation cache and webhook ids are process-wide. */
export const channelHistory = new ChannelHistory();
