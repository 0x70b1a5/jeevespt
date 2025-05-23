import dayjs from "dayjs"
import { Message } from "discord.js"

export const prependTimestampAndUsername = (message: Message) => {
    return `${dayjs(message.createdTimestamp).format('MM/DD/YYYY HH:mm:ss')} [${message.author.username}]: ${message.cleanContent}`;
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