import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils } from './utils';
import { ResponseFrequency } from '../bot';

const VALID_FREQUENCIES = ['all', 'mentions', 'none'] as const;

const FREQUENCY_MAP: Record<string, ResponseFrequency> = {
    'all': ResponseFrequency.EveryMessage,
    'mentions': ResponseFrequency.WhenMentioned,
    'none': ResponseFrequency.None
};

const FREQUENCY_DESCRIPTIONS: Record<string, string> = {
    'all': 'respond to every message',
    'mentions': 'only respond when mentioned',
    'none': 'ignore all messages'
};

/**
 * !config - Configure channel membership
 */
export const configCommand: Command = {
    names: ['config'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        // Show current configuration if no args
        if (ctx.args.length === 0) {
            await showChannelConfiguration(ctx, deps);
            return;
        }

        // Show usage if only one arg
        if (ctx.args.length < 2) {
            await commandUtils.reply(
                ctx.message,
                `Usage: \`!config <#channel> <responseFrequency>\`\n` +
                `Response frequencies: \`all\`, \`mentions\`, \`none\`\n` +
                `Example: \`!config #general all\` - respond to every message in #general\n` +
                `Example: \`!config #random mentions\` - only respond when mentioned in #random\n` +
                `Example: \`!config #off-topic none\` - ignore messages in #off-topic`
            );
            return;
        }

        const channelName = ctx.args[0];
        const frequencyStr = ctx.args[1].toLowerCase();

        // Validate response frequency
        if (!VALID_FREQUENCIES.includes(frequencyStr as any)) {
            await commandUtils.reply(
                ctx.message,
                `Invalid response frequency: \`${frequencyStr}\`\n${ctx.args.join()}\n` +
                `Valid options: ${VALID_FREQUENCIES.map(f => `\`${f}\``).join(', ')}`
            );
            return;
        }

        // Find the channel
        const channelId = commandUtils.getChannelIdFromName(ctx.message, channelName);
        if (!channelId) {
            await commandUtils.reply(ctx.message, `Could not find channel "${channelName}".`);
            return;
        }

        const responseFrequency = FREQUENCY_MAP[frequencyStr];
        deps.state.setChannelMembership(ctx.id, ctx.isDM, channelId, { responseFrequency });

        const channel = ctx.message.guild!.channels.cache.get(channelId);
        const channelMention = channel ? `<#${channelId}>` : channelName;
        const behaviorDescription = FREQUENCY_DESCRIPTIONS[frequencyStr];

        await commandUtils.reply(
            ctx.message,
            `Configured ${channelMention} to **${responseFrequency}** mode.\n` +
            `I will ${behaviorDescription} in that channel.`
        );
    }
};

/**
 * Show current channel configuration
 */
async function showChannelConfiguration(ctx: CommandContext, deps: CommandDependencies): Promise<void> {
    const memberships = deps.state.getAllChannelMemberships(ctx.id, ctx.isDM);

    if (memberships.size === 0) {
        await commandUtils.reply(
            ctx.message,
            `No channels are currently configured.\n` +
            `Use \`!config <#channel> <responseFrequency>\` to configure a channel.\n` +
            `Response frequencies: \`all\`, \`mentions\`, \`none\``
        );
        return;
    }

    let configList = '📋 **Channel Configuration:**\n\n';
    for (const [channelId, membership] of memberships) {
        const channel = ctx.message.guild!.channels.cache.get(channelId);
        const channelName = channel ? `<#${channelId}>` : `Unknown (${channelId})`;
        configList += `• ${channelName}: **${membership.responseFrequency}**\n`;
    }

    await ctx.message.reply(configList);
}

// Export channel config commands
export const channelConfigCommands: Command[] = [
    configCommand
];
