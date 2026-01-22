import { Message } from 'discord.js';
import { MessageParam } from '@anthropic-ai/sdk/resources';
import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils, CommandUtilsImpl } from './utils';
import { prependTimestampAndUsername, extractEmbedDataToText } from '../formatMessage';
import { LUGSO_PROMPT } from '../prompts/lugso';

/**
 * !reacton - Enable reaction mode
 */
export const reactOnCommand: Command = {
    names: ['reacton'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { reactionModeEnabled: true });
        await commandUtils.reply(ctx.message, 'Reaction mode enabled.');
    }
};

/**
 * !reactoff - Disable reaction mode
 */
export const reactOffCommand: Command = {
    names: ['reactoff'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { reactionModeEnabled: false });
        await commandUtils.reply(ctx.message, 'Reaction mode disabled.');
    }
};

/**
 * !reactadd - Add a channel to reaction mode
 */
export const reactAddCommand: Command = {
    names: ['reactadd'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const channelName = ctx.args[0];

        if (!channelName) {
            await commandUtils.reply(ctx.message, 'Please specify a channel name.');
            return;
        }

        const config = deps.state.getConfig(ctx.id, ctx.isDM);
        const channelId = commandUtils.getChannelIdFromName(ctx.message, channelName);

        if (!channelId) {
            await commandUtils.reply(ctx.message, `Could not find channel "${channelName}".`);
            return;
        }

        if (config.reactionChannels.includes(channelId)) {
            await commandUtils.reply(ctx.message, `Channel "${channelName}" is already in the reaction list.`);
            return;
        }

        const newChannels = [...config.reactionChannels, channelId];
        deps.state.updateConfig(ctx.id, ctx.isDM, { reactionChannels: newChannels });
        await commandUtils.reply(ctx.message, `Added channel "${channelName}" to reaction mode.`);
    }
};

/**
 * !reactremove - Remove a channel from reaction mode
 */
export const reactRemoveCommand: Command = {
    names: ['reactremove'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const channelName = ctx.args[0];

        if (!channelName) {
            await commandUtils.reply(ctx.message, 'Please specify a channel name.');
            return;
        }

        const config = deps.state.getConfig(ctx.id, ctx.isDM);
        const channelId = commandUtils.getChannelIdFromName(ctx.message, channelName);

        if (!channelId) {
            await commandUtils.reply(ctx.message, `Could not find channel "${channelName}".`);
            return;
        }

        if (!config.reactionChannels.includes(channelId)) {
            await commandUtils.reply(ctx.message, `Channel "${channelName}" is not in the reaction list.`);
            return;
        }

        const newChannels = config.reactionChannels.filter(c => c !== channelId);
        deps.state.updateConfig(ctx.id, ctx.isDM, { reactionChannels: newChannels });
        await commandUtils.reply(ctx.message, `Removed channel "${channelName}" from reaction mode.`);
    }
};

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

        const response = await deps.anthropic.messages.create({
            model: config.model,
            max_tokens: 30,
            temperature: config.temperature,
            messages,
            system: systemPrompt?.content || ''
        });

        const responseText = response.content[0].type === 'text'
            ? response.content[0].text
            : '';

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
export const reactionCommands: Command[] = [
    reactOnCommand,
    reactOffCommand,
    reactAddCommand,
    reactRemoveCommand
];
