import { Message } from 'discord.js';
import { MessageParam } from '@anthropic-ai/sdk/resources';
import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils, CommandUtilsImpl } from './utils';
import { buildListMessage, registerListKind } from './listPanel';
import { generateText } from '../llm/generate';
import { prependTimestampAndUsername, extractEmbedDataToText } from '../formatMessage';
import { LUGSO_PROMPT } from '../prompts/lugso';

/** Channels where the bot adds emoji reactions, with a ❌ per channel. */
export const reactionChannelList = registerListKind({
    code: 'react',
    command: 'reactchannels',
    title: '😀 Reaction channels',
    empty: 'No channels yet. Add one with `/reactchannels channel:#channel`.',
    header: (deps, scope) =>
        `Reactions are **${deps.state.getConfig(scope.id, scope.isDM).reactionModeEnabled ? 'on' : 'off'}** (toggle in \`/settings\` → Features).`,
    entries: (deps, scope) => deps.state.getConfig(scope.id, scope.isDM).reactionChannels.map(channelId => ({
        value: channelId,
        text: `<#${channelId}>`
    })),
    remove: (deps, scope, entry) => {
        const config = deps.state.getConfig(scope.id, scope.isDM);
        deps.state.updateConfig(scope.id, scope.isDM, {
            reactionChannels: config.reactionChannels.filter(c => c !== entry.value)
        });
    }
});

/**
 * !reactchannels [#channel] — list reaction channels (❌ to remove), or add one.
 */
export const reactChannelsCommand: Command = {
    names: ['reactchannels'],
    requiresGuild: true,
    description: 'Channels where the bot reacts with emoji; give a channel to add it (remove with buttons).',
    category: 'Reactions',
    options: [{ name: 'channel', description: 'Channel to add', type: 'channel', required: false }],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const scope = { id: ctx.id, isDM: ctx.isDM, ownerId: ctx.message.author.id };
        let note: string | undefined;
        const channelName = ctx.args[0];
        if (channelName) {
            const channelId = commandUtils.getChannelIdFromName(ctx.message, channelName);
            if (!channelId) {
                await commandUtils.reply(ctx.message, `Could not find channel "${channelName}".`);
                return;
            }
            const config = deps.state.getConfig(ctx.id, ctx.isDM);
            if (config.reactionChannels.includes(channelId)) {
                note = `<#${channelId}> is already on the list.`;
            } else {
                deps.state.updateConfig(ctx.id, ctx.isDM, { reactionChannels: [...config.reactionChannels, channelId] });
                note = `✅ Added <#${channelId}>`;
            }
        }
        await ctx.message.reply(buildListMessage(reactionChannelList, deps, scope, note));
    }
};

/**
 * Detect messages whose only content is image attachment(s) — no text and no
 * other attachment types. The reaction prompt only sends message text to the
 * model (the image itself isn't included), so reacting to these would just burn
 * API tokens on an empty prompt. We skip them.
 */
function isImageOnlyMessage(message: Message): boolean {
    if (message.content.trim().length > 0) return false;

    const attachments = [...message.attachments.values()];
    if (attachments.length === 0) return false;

    return attachments.every(a =>
        a.contentType?.startsWith('image/') ?? (a.width != null && a.height != null)
    );
}

/**
 * Handle generating and adding a reaction to a message
 */
export async function handleReaction(message: Message, deps: CommandDependencies): Promise<void> {
    if (!message.guild) return;
    if (message.author.bot) return;

    const id = message.guild.id;
    const config = deps.state.getConfig(id, false);

    if (!config.reactionModeEnabled || config.reactionChannels.length === 0) return;
    if (!config.reactionChannels.includes(message.channel.id)) return;
    if (isImageOnlyMessage(message)) return;

    // Wait for embeds if message contains URLs
    const utils = new CommandUtilsImpl();
    if (utils.hasURLs(message.content)) {
        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    const emoji = await generateEmojiReaction(message, deps);
    if (emoji) {
        try {
            await message.react(emoji);
            deps.state.recordReaction(id, false, emoji, message.content, message.channel.id);
            console.log(`🎭 Recorded reaction: ${emoji} for guild ${id}`);
        } catch (error) {
            console.error('Error reacting to message:', error);
        }
    }
}

/**
 * Generate an appropriate emoji reaction for a message
 */
async function generateEmojiReaction(message: Message, deps: CommandDependencies): Promise<string | null> {
    try {
        const recentMessages = await message.channel.messages.fetch({ limit: 10 });
        let userMessage = prependTimestampAndUsername(message);
        userMessage += extractEmbedDataToText(message);

        const channelHistory = [...recentMessages.values()]
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .map(msg => ({
                role: "user",
                content: userMessage
            }));

        const id = message.guild!.id;
        const config = deps.state.getConfig(id, false);

        // Get system prompt based on mode
        const systemPrompt = getSystemPromptForMode(id, false, deps);

        // Get recent reactions for variety
        const recentReactions = deps.state.getRecentReactions(id, false);
        let reactionContext = '';
        if (recentReactions.length > 0) {
            const recentEmojis = recentReactions.map(r => r.emoji).join(', ');
            reactionContext = `\n\nIMPORTANT: My recent reactions were: ${recentEmojis}. Please choose a different emoji to add variety and avoid repetition.`;
        }

        const messages = [
            ...channelHistory,
            {
                role: "user",
                content: `Based on this conversation, please respond to the most recent message with a single emoji that would be an appropriate reaction. Only respond with the emoji itself.${reactionContext}`
            }
        ] as MessageParam[];

        const result = await generateText(
            { anthropic: deps.anthropic, xai: deps.xai, poolside: deps.poolside },
            {
                model: config.model,
                maxTokens: 30,
                temperature: config.temperature,
                messages: messages.map(m => ({
                    role: typeof m.role === 'string' ? m.role : 'user',
                    content: typeof m.content === 'string' ? m.content : String(m.content ?? '')
                })),
                system: systemPrompt?.content || ''
            }
        );

        const responseText = result.content || '';

        const emojiMatch = responseText.trim().match(/^(\p{Emoji}|:\w+:)$/u);
        if (emojiMatch) {
            return emojiMatch[0];
        }

        console.log(`🤖 Generated emoji reaction: ${responseText}`);
        return null;
    } catch (error) {
        console.error('Error generating emoji reaction:', error);
        return null;
    }
}

/**
 * Get system prompt for a given mode (duplicated here to avoid circular dependency)
 */
function getSystemPromptForMode(id: string, isDM: boolean, deps: CommandDependencies): { role: string; content: string } | null {
    const config = deps.state.getConfig(id, isDM);
    // Import prompts lazily to avoid circular deps
    const { JEEVES_PROMPT, TOKIPONA_PROMPT } = require('../prompts/prompts');

    switch (config.mode) {
        case 'tokipona':
            return { role: 'system', content: TOKIPONA_PROMPT };
        case 'whisper':
            return null;
        case 'customprompt':
            return { role: 'system', content: deps.state.getCustomPrompt(id, isDM) };
        case 'lugso':
            return { role: 'system', content: LUGSO_PROMPT };
        case 'jeeves':
        default:
            return { role: 'system', content: JEEVES_PROMPT };
    }
}

// Export all reaction commands
export const reactionCommands: Command[] = [reactChannelsCommand];
