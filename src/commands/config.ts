import { TextBasedChannel } from 'discord.js';
import { Command, CommandContext, CommandDependencies } from './types';
import { SYS_PREFIX, MODEL_CACHE_DURATION } from './constants';
import { channelHistory, toLlmMessages } from '../chat/history';
import { commandUtils } from './utils';
import { VALID_ANTHROPIC_MODELS, VALID_XAI_MODELS, VALID_POOLSIDE_MODELS, isXaiModel, isPoolsideModel } from '../state';
import { registry } from './registry';
import { buildHelpEmbed, buildCommandDetailEmbed } from './helpText';

/**
 * Type guard to check if a channel supports sending messages
 */
function isSendableChannel(channel: any): channel is TextBasedChannel & { send: Function } {
    return channel && typeof channel.send === 'function';
}

/**
 * !help - Display help information
 */
export const helpCommand: Command = {
    names: ['help'],
    description: 'Show the command list, or detailed help for one command.',
    category: 'General',
    options: [{ name: 'command', description: 'Command to get detailed help for', type: 'string', required: false }],
    examples: ['!help', '!help task'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const config = deps.state.getConfig(ctx.id, ctx.isDM);

        // !help <command> → detailed help for that single command.
        const query = ctx.args[0]?.replace(/^!/, '').toLowerCase();
        if (query) {
            const cmd = registry.get(query);
            if (!cmd || cmd.hidden) {
                await commandUtils.reply(ctx.message, `No such command: \`${query}\`. Use \`!help\` to list commands.`);
                return;
            }
            await ctx.message.reply({ embeds: [buildCommandDetailEmbed(cmd)] });
            return;
        }

        // !help → one compact, generated listing of every command.
        const statusLines = [
            `**Mode:** \`${config.mode}\`  •  **Model:** \`${config.model}\``,
            `**Memory:** ${config.messageLimit} msgs  •  **Temp:** ${config.temperature}  •  **Max tokens:** ${config.maxResponseLength}`,
            `**Web search:** ${config.webSearchEnabled ? `on (≤${config.webSearchMaxUses})` : 'off'}  •  **Thinking:** ${config.extendedThinking ? 'on' : 'off'}  •  **Voice:** ${config.useVoiceResponse ? 'on' : 'off'}  •  **Persist:** ${config.shouldSaveData ? 'on' : 'off'}`,
            `⚙️ Change any of these, and the persona, with \`/settings\`.`
        ];
        await ctx.message.reply({ embeds: [buildHelpEmbed(registry.getCommands(), statusLines)] });
    }
};

/**
 * !clear - Clear message history
 */
export const clearCommand: Command = {
    names: ['clear'],
    description: 'Forget everything from the present conversation.',
    category: 'Chat History',
    ephemeral: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.resetContext(ctx.id, ctx.isDM);
        await commandUtils.reply(ctx.message, 'Conversation context starts afresh from here.');
    }
};

/**
 * !log - Show the chat context the bot would read in this channel
 */
export const logCommand: Command = {
    names: ['log'],
    description: 'Print the recent channel history the bot reads when replying here.',
    category: 'Chat History',
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const config = deps.state.getConfig(ctx.id, ctx.isDM);
        const lines = await channelHistory.fetch(ctx.message.channel, { limit: config.messageLimit, since: config.contextResetAt });
        const logAsString = toLlmMessages(lines).map(m => `${m.role}: ${m.content}`).join('\n') || '(nothing yet)';
        const chunks = commandUtils.splitMessageIntoChunks([{ role: 'assistant', content: logAsString }]);

        await commandUtils.reply(ctx.message, 'CURRENT MEMORY:\n---');
        const channel = ctx.message.channel;
        if (isSendableChannel(channel)) {
            for (const chunk of chunks) {
                if (chunk) await channel.send(chunk);
            }
            await channel.send(`${SYS_PREFIX}---`);
        }
    }
};

/**
 * Model list cache for API validation (Anthropic + xAI)
 */
let modelListCache: string[] | null = null;
let modelListCacheTime = 0;

async function fetchAnthropicModels(): Promise<string[]> {
    try {
        const response = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY || '',
                'anthropic-version': '2023-06-01'
            }
        });

        if (response.ok) {
            const data = await response.json() as { data: Array<{ id: string }> };
            const ids = data.data.map(model => model.id);
            console.log(`✅ Fetched ${ids.length} models from Anthropic API`);
            return ids;
        }
        console.warn(`⚠️ Failed to fetch Anthropic models (${response.status}), using static list`);
    } catch (error) {
        console.warn(`⚠️ Error fetching Anthropic models, using static list:`, error);
    }
    return [...VALID_ANTHROPIC_MODELS];
}

async function fetchXaiModels(): Promise<string[]> {
    try {
        const response = await fetch('https://api.x.ai/v1/models', {
            headers: {
                Authorization: `Bearer ${process.env.XAI_API_KEY || ''}`
            }
        });

        if (response.ok) {
            const data = await response.json() as { data: Array<{ id: string }> };
            // Prefer chat/text models; filter out image/video-only ids when obvious
            const ids = data.data
                .map(model => model.id)
                .filter(id => id.startsWith('grok-') && !id.includes('imagine') && !id.includes('image') && !id.includes('video'));
            console.log(`✅ Fetched ${ids.length} models from xAI API`);
            return ids.length > 0 ? ids : [...VALID_XAI_MODELS];
        }
        console.warn(`⚠️ Failed to fetch xAI models (${response.status}), using static list`);
    } catch (error) {
        console.warn(`⚠️ Error fetching xAI models, using static list:`, error);
    }
    return [...VALID_XAI_MODELS];
}

async function fetchPoolsideModels(): Promise<string[]> {
    try {
        const response = await fetch('https://inference.poolside.ai/v1/models', {
            headers: {
                Authorization: `Bearer ${process.env.POOLSIDE_API_KEY || ''}`
            }
        });

        if (response.ok) {
            const data = await response.json() as { data: Array<{ id: string }> };
            const ids = data.data
                .map(model => model.id)
                .filter(id => id.startsWith('poolside/'));
            console.log(`✅ Fetched ${ids.length} models from Poolside API`);
            return ids.length > 0 ? ids : [...VALID_POOLSIDE_MODELS];
        }
        console.warn(`⚠️ Failed to fetch Poolside models (${response.status}), using static list`);
    } catch (error) {
        console.warn(`⚠️ Error fetching Poolside models, using static list:`, error);
    }
    return [...VALID_POOLSIDE_MODELS];
}

export async function getValidModels(): Promise<string[]> {
    const now = Date.now();
    if (modelListCache && (now - modelListCacheTime) < MODEL_CACHE_DURATION) {
        return modelListCache;
    }

    const [anthropicModels, xaiModels, poolsideModels] = await Promise.all([
        fetchAnthropicModels(),
        fetchXaiModels(),
        fetchPoolsideModels()
    ]);

    modelListCache = [...anthropicModels, ...xaiModels, ...poolsideModels];
    modelListCacheTime = now;
    return modelListCache;
}

function formatModelList(models: string[], current?: string): string {
    return models
        .map(m => `• \`${m}\`${m === current ? ' ⭐ (current)' : ''}`)
        .join('\n');
}

/**
 * !model - Set or list AI models (Anthropic Claude + xAI Grok)
 */
export const modelCommand: Command = {
    names: ['model'],
    description: 'Set the AI model (Claude, Grok, or Poolside), or list available models.',
    category: 'Configuration',
    ephemeral: true,
    options: [{ name: 'model', description: 'Model id; omit to list models', type: 'string', required: false }],
    deferred: true, // fetches model lists from Anthropic + xAI + Poolside APIs
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const modelName = ctx.args[0];

        if (!modelName) {
            const validModels = await getValidModels();
            const currentConfig = deps.state.getConfig(ctx.id, ctx.isDM);
            const anthropic = validModels.filter(m => !isXaiModel(m) && !isPoolsideModel(m));
            const xai = validModels.filter(m => isXaiModel(m));
            const poolsideModels = validModels.filter(m => isPoolsideModel(m));

            await commandUtils.reply(
                ctx.message,
                `**Anthropic (Claude):**\n${formatModelList(anthropic, currentConfig.model)}\n\n` +
                `**xAI (Grok):**\n${formatModelList(xai, currentConfig.model)}\n\n` +
                `**Poolside:**\n${formatModelList(poolsideModels, currentConfig.model)}\n\n` +
                `Use \`!model <model_name>\` to switch. Example: \`!model poolside/laguna-xs-2.1\``
            );
            return;
        }

        const validModels = await getValidModels();
        const recognized = validModels.includes(modelName) || isXaiModel(modelName) || isPoolsideModel(modelName);

        deps.state.updateConfig(ctx.id, ctx.isDM, { model: modelName });

        if (!recognized) {
            const anthropic = validModels.filter(m => !isXaiModel(m) && !isPoolsideModel(m));
            const xai = validModels.filter(m => isXaiModel(m));
            const poolside = validModels.filter(m => isPoolsideModel(m));
            await commandUtils.reply(
                ctx.message,
                `Model set to \`${modelName}\`.\n\n` +
                `**⚠️ Warning:** \`${modelName}\` is not a recognized model. ` +
                `This may be fine for testing, but an invalid id will fail when generating responses.\n\n` +
                `**Anthropic:**\n${formatModelList(anthropic)}\n\n` +
                `**xAI:**\n${formatModelList(xai)}\n\n` +
                `**Poolside:**\n${formatModelList(poolside)}`
            );
        } else {
            const provider = isXaiModel(modelName) ? 'xAI Grok' : (isPoolsideModel(modelName) ? 'Poolside' : 'Anthropic Claude');
            await commandUtils.reply(
                ctx.message,
                `Model set to \`${modelName}\` (${provider}).`
            );
        }
    }
};

// Export all config commands
export const configCommands: Command[] = [
    helpCommand,
    clearCommand,
    logCommand,
    modelCommand
];
