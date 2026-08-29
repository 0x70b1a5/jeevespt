import dayjs from "dayjs"
import { Attachment, Message } from "discord.js"

export const prependTimestampAndUsername = (message: Message) => {
    // Get display name from guild member if available, fallback to username
    const displayName = message.member?.displayName;
    const username = message.author.username;

    // Format: timestamp [handle/displayname]: content
    const userIdentifier = displayName && displayName !== username ? `${username}/${displayName}` : username;
    return `${dayjs(message.createdTimestamp).format('MM/DD/YYYY HH:mm:ss')} [${userIdentifier}]: ${message.cleanContent}`;
}

export const extractEmbedDataToText = (message: Message) => {
    let formatted = '';
    if (message.embeds) {
        for (const embed of message.embeds) {
            if (embed.url) {
                formatted += `\n[${embed.url}](${embed.url})`;
            }
            if (embed.provider) {
                formatted += `\n${embed.provider.name}`;
            }
            if (embed.author) {
                formatted += `\n${embed.author.name}`;
            }
            if (embed.title) {
                formatted += `\n${embed.title}`;
            }
            if (embed.description) {
                formatted += `\n${embed.description}`;
            }
            if (embed.footer) {
                formatted += `\n${embed.footer.text}`;
            }
        }
    }
    return formatted;
}

/**
 * Discord "Forward" posts an empty wrapper; the original lives on
 * `messageSnapshots`. Without this, Jeeves sees a blank envelope.
 */
export const extractForwardedContent = (message: Message): string => {
    const snapshots = message.messageSnapshots;
    if (!snapshots?.size) return '';

    const parts: string[] = [];
    for (const snapshot of snapshots.values()) {
        const text = snapshot.cleanContent || snapshot.content || '';
        const embeds = extractEmbedDataToText(snapshot as unknown as Message);
        const attNames = snapshot.attachments
            ? [...snapshot.attachments.values()].map(a => a.name).filter(Boolean)
            : [];
        const body = [text, embeds.trim(), attNames.length ? `(attachments: ${attNames.join(', ')})` : '']
            .filter(Boolean)
            .join('\n');
        parts.push(
            body
                ? `[SYSTEM] The user forwarded a message:\n\n${body}`
                : '[SYSTEM] The user forwarded a message whose content was empty or unavailable.'
        );
    }
    return parts.length ? '\n' + parts.join('\n') : '';
}

/** Outer attachments plus any on forwarded snapshots. */
export const allMessageAttachments = (message: Message): Attachment[] => {
    const out = [...(message.attachments?.values() ?? [])];
    const snapshots = message.messageSnapshots;
    if (!snapshots?.size) return out;
    for (const snapshot of snapshots.values()) {
        if (snapshot.attachments?.size) {
            out.push(...snapshot.attachments.values());
        }
    }
    return out;
}

// Extract only translatable prose content from embeds (for autotranslate)
// Skips URLs, provider names, and other metadata
export const extractTranslatableEmbedContent = (message: Message) => {
    let formatted = '';
    if (message.embeds) {
        for (const embed of message.embeds) {
            // Only include description - this is the main prose content
            if (embed.description) {
                formatted += `\n${embed.description}`;
            }
            // Only include title if it's not just a URL or domain name
            if (embed.title && !embed.title.match(/^https?:\/\//i) && !embed.title.match(/^\S+\.\S+$/)) {
                formatted += `\n${embed.title}`;
            }
        }
    }
    return formatted;
}