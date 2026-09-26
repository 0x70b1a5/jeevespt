import { Message } from 'discord.js';
import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils, CommandUtilsImpl } from './utils';
import { buildListMessage, registerListKind } from './listPanel';
import { isTypesafeConfigured } from '../llm/typesafe';
import { channelHistory } from '../chat/history';
import { chooseReaction, guildCustomEmoji } from '../chat/gate';

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
 * Pick an emoji for the message with Jev: a Choice over a curated set plus the
 * server's own emoji, steered away from recently used ones (see chat/gate.ts).
 */
async function generateEmojiReaction(message: Message, deps: CommandDependencies): Promise<string | null> {
    if (!isTypesafeConfigured()) {
        console.warn('⚠️ Reactions need TYPESAFE_API_KEY; skipping.');
        return null;
    }
    try {
        const id = message.guild!.id;
        const config = deps.state.getConfig(id, false);
        const lines = await channelHistory.fetch(message.channel, { limit: 10, since: config.contextResetAt });
        const upToMessage = lines.slice(0, lines.findIndex(line => line.id === message.id) + 1);
        if (!upToMessage.length) return null;

        const emoji = await chooseReaction(upToMessage, {
            mode: config.mode,
            channelName: (message.channel as any).name,
            customEmoji: guildCustomEmoji(message.guild),
            recentEmoji: deps.state.getRecentReactions(id, false).map(r => r.emoji)
        });
        console.log(`🤖 Jev picked reaction: ${emoji}`);
        return emoji;
    } catch (error) {
        console.error('Error generating emoji reaction:', error);
        return null;
    }
}

// Export all reaction commands
export const reactionCommands: Command[] = [reactChannelsCommand];
