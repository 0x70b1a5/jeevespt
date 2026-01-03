import dayjs from "dayjs"
import { Message } from "discord.js"

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