import { TextBasedChannel } from 'discord.js';
import { Command, CommandContext, CommandDependencies } from './types';
import { SYS_PREFIX, MODEL_CACHE_DURATION } from './constants';
import { commandUtils } from './utils';
import { VALID_ANTHROPIC_MODELS, VALID_XAI_MODELS, isXaiModel } from '../bot';
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
            `**Web search:** ${config.webSearchEnabled ? `on (≤${config.webSearchMaxUses})` : 'off'}  •  **Thinking:** ${config.extendedThinking ? 'on' : 'off'}  •  **Voice:** ${config.useVoiceResponse ? 'on' : 'off'}  •  **Persist:** ${config.shouldSaveData ? 'on' : 'off'}`
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
        const log = deps.state.getLog(ctx.id, ctx.isDM);
        log.messages = [];
        await commandUtils.reply(ctx.message, 'Cleared messages log.');
    }
};

/**
 * !log - Show current message log
 */
export const logCommand: Command = {
    names: ['log'],
    description: 'Print the current message history.',
    category: 'Chat History',
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const log = deps.state.getLog(ctx.id, ctx.isDM);
        const logAsString = JSON.stringify(log.messages, null, 2);
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
 * !temperature - Set AI temperature
 */
export const temperatureCommand: Command = {
    names: ['temperature'],
    description: 'Set sampling temperature (0–2).',
    category: 'Configuration',
    ephemeral: true,
    options: [{ name: 'value', description: 'Temperature between 0 and 2', type: 'number', required: true }],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const value = ctx.args[0];
        const temp = Number(value);

        if (!isNaN(temp) && temp > 0 && temp <= 2) {
            deps.state.updateConfig(ctx.id, ctx.isDM, { temperature: temp });
            await commandUtils.reply(ctx.message, `Temperature set to \`${temp}\`.`);
        } else {
            await commandUtils.reply(
                ctx.message,
                `Couldn't parse requested temperature: \`${value}\`. Must be a decimal between 0 and 2.`
            );
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

async function getValidModels(): Promise<string[]> {
    const now = Date.now();
    if (modelListCache && (now - modelListCacheTime) < MODEL_CACHE_DURATION) {
        return modelListCache;
    }

    const [anthropicModels, xaiModels] = await Promise.all([
        fetchAnthropicModels(),
        fetchXaiModels()
    ]);

    modelListCache = [...anthropicModels, ...xaiModels];
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
    description: 'Set the AI model (Claude or Grok), or list available models.',
    category: 'Configuration',
    ephemeral: true,
    options: [{ name: 'model', description: 'Model id; omit to list models', type: 'string', required: false }],
    deferred: true, // fetches model lists from Anthropic + xAI APIs
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const modelName = ctx.args[0];

        if (!modelName) {
            const validModels = await getValidModels();
            const currentConfig = deps.state.getConfig(ctx.id, ctx.isDM);
            const anthropic = validModels.filter(m => !isXaiModel(m));
            const xai = validModels.filter(m => isXaiModel(m));

            await commandUtils.reply(
                ctx.message,
                `**Anthropic (Claude):**\n${formatModelList(anthropic, currentConfig.model)}\n\n` +
                `**xAI (Grok):**\n${formatModelList(xai, currentConfig.model)}\n\n` +
                `Use \`!model <model_name>\` to switch. Example: \`!model grok-4.5\``
            );
            return;
        }

        const validModels = await getValidModels();
        const recognized = validModels.includes(modelName) || isXaiModel(modelName);

        deps.state.updateConfig(ctx.id, ctx.isDM, { model: modelName });

        if (!recognized) {
            const anthropic = validModels.filter(m => !isXaiModel(m));
            const xai = validModels.filter(m => isXaiModel(m));
            await commandUtils.reply(
                ctx.message,
                `Model set to \`${modelName}\`.\n\n` +
                `**⚠️ Warning:** \`${modelName}\` is not a recognized model. ` +
                `This may be fine for testing, but an invalid id will fail when generating responses.\n\n` +
                `**Anthropic:**\n${formatModelList(anthropic)}\n\n` +
                `**xAI:**\n${formatModelList(xai)}`
            );
        } else {
            const provider = isXaiModel(modelName) ? 'xAI Grok' : 'Anthropic Claude';
            await commandUtils.reply(
                ctx.message,
                `Model set to \`${modelName}\` (${provider}).`
            );
        }
    }
};

/**
 * !delay - Set response delay
 */
export const delayCommand: Command = {
    names: ['delay'],
    description: 'Set the response delay in seconds (lets the bot wait for follow-up messages).',
    category: 'Configuration',
    ephemeral: true,
    options: [{ name: 'seconds', description: 'Delay in seconds (greater than 0)', type: 'integer', required: true }],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const delay = Math.round(Number(ctx.args[0]));

        if (!isNaN(delay) && delay > 0) {
            deps.state.updateConfig(ctx.id, ctx.isDM, { responseDelayMs: delay * 1000 });
            await commandUtils.reply(ctx.message, `Response delay set to ${delay} seconds.`);
        } else {
            await commandUtils.reply(
                ctx.message,
                'Failed to parse requested delay. Format: `!delay SECONDS` where SECONDS is a number greater than zero.'
            );
        }
    }
};

/**
 * !tokens - Set max response tokens
 */
export const tokensCommand: Command = {
    names: ['tokens'],
    description: 'Set the maximum number of tokens to generate.',
    category: 'Configuration',
    ephemeral: true,
    options: [{ name: 'tokens', description: 'Max tokens (greater than 0)', type: 'integer', required: true }],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const tokens = Number(ctx.args[0]);

        if (!isNaN(tokens) && tokens > 0) {
            deps.state.updateConfig(ctx.id, ctx.isDM, { maxResponseLength: tokens });
            await commandUtils.reply(ctx.message, `Max response length set to ${tokens} tokens.`);
        } else {
            await commandUtils.reply(
                ctx.message,
                'Failed to parse requested tokens. Format: `!tokens TOKENS` where TOKENS is a number greater than zero.'
            );
        }
    }
};

/**
 * !speedscalar - Set transcription speed scalar
 */
export const speedScalarCommand: Command = {
    names: ['speedscalar'],
    description: 'Set the transcription speed scalar (0.5–4.0); audio is sped up before Whisper.',
    category: 'Configuration',
    ephemeral: true,
    options: [{ name: 'scalar', description: 'Speed scalar between 0.5 and 4.0', type: 'number', required: true }],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const scalar = Number(ctx.args[0]);

        if (!isNaN(scalar) && scalar >= 0.5 && scalar <= 4.0) {
            deps.state.updateConfig(ctx.id, ctx.isDM, { transcriptionSpeedScalar: scalar });
            if (scalar === 1.0) {
                await commandUtils.reply(ctx.message, `Transcription speed scalar set to \`${scalar}\` (normal speed).`);
            } else {
                await commandUtils.reply(
                    ctx.message,
                    `Transcription speed scalar set to \`${scalar}\`. Audio will be sped up ${scalar}x before transcription.`
                );
            }
        } else {
            await commandUtils.reply(
                ctx.message,
                'Failed to parse speed scalar. Format: `!speedscalar FLOAT` where FLOAT is between 0.5 and 4.0 (default: 1.0).'
            );
        }
    }
};

/**
 * !limit - Set message memory limit
 */
export const limitCommand: Command = {
    names: ['limit'],
    description: 'Set how many past messages the bot remembers.',
    category: 'Chat History',
    ephemeral: true,
    options: [{ name: 'count', description: 'Number of messages to remember (greater than 0)', type: 'integer', required: true }],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const limit = Number(ctx.args[0]);

        if (!isNaN(limit) && limit > 0) {
            deps.state.updateConfig(ctx.id, ctx.isDM, { messageLimit: limit });
            await commandUtils.reply(ctx.message, `Message memory is now ${limit} messages.`);
        } else {
            await commandUtils.reply(
                ctx.message,
                'Failed to parse requested limit. Format: `!limit X` where X is a number greater than zero.'
            );
        }
    }
};

/**
 * !persist - Toggle data persistence
 */
export const persistCommand: Command = {
    names: ['persist'],
    description: 'Toggle whether data is saved between sessions.',
    category: 'Configuration',
    ephemeral: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const config = deps.state.getConfig(ctx.id, ctx.isDM);
        const newValue = !config.shouldSaveData;
        deps.state.updateConfig(ctx.id, ctx.isDM, { shouldSaveData: newValue });
        await commandUtils.reply(ctx.message, `Bot will now ${newValue ? 'SAVE' : 'NOT SAVE'} data to disk.`);
    }
};

/**
 * !dms - Toggle DM responses
 */
export const dmsCommand: Command = {
    names: ['dms'],
    description: 'Toggle whether the bot responds to direct messages.',
    category: 'Configuration',
    ephemeral: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const config = deps.state.getConfig(ctx.id, ctx.isDM);
        const newValue = !config.allowDMs;
        deps.state.updateConfig(ctx.id, ctx.isDM, { allowDMs: newValue });
        await commandUtils.reply(ctx.message, `Direct messages are now ${newValue ? 'ENABLED' : 'DISABLED'}.`);
    }
};

/**
 * !voiceon/!voiceoff - Toggle voice responses
 */
export const voiceOnCommand: Command = {
    names: ['voiceon'],
    description: 'Enable voice (text-to-speech) responses.',
    category: 'Configuration',
    ephemeral: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { useVoiceResponse: true });
        await commandUtils.reply(ctx.message, 'Voice responses are now ENABLED.');
    }
};

export const voiceOffCommand: Command = {
    names: ['voiceoff'],
    description: 'Disable voice responses.',
    category: 'Configuration',
    ephemeral: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { useVoiceResponse: false });
        await commandUtils.reply(ctx.message, 'Voice responses are now DISABLED.');
    }
};

/**
 * !thinkon/!thinkoff - Toggle extended thinking mode
 */
export const thinkOnCommand: Command = {
    names: ['thinkon'],
    description: 'Enable extended thinking mode (+3000 thinking tokens).',
    category: 'Configuration',
    ephemeral: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { extendedThinking: true });
        await commandUtils.reply(ctx.message, 'Extended thinking is now ENABLED. (adds 3000 thinking tokens to API calls)');
    }
};

export const thinkOffCommand: Command = {
    names: ['thinkoff'],
    description: 'Disable extended thinking mode.',
    category: 'Configuration',
    ephemeral: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { extendedThinking: false });
        await commandUtils.reply(ctx.message, 'Extended thinking is now DISABLED.');
    }
};

/**
 * !websearchon/!websearchoff - Toggle web search tool
 */
export const webSearchOnCommand: Command = {
    names: ['websearchon', 'searchon'],
    description: 'Enable the web search tool; the bot may consult the internet.',
    category: 'Configuration',
    ephemeral: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { webSearchEnabled: true });
        await commandUtils.reply(ctx.message, 'Web search is now ENABLED. The bot may consult the internet when answering.');
    }
};

export const webSearchOffCommand: Command = {
    names: ['websearchoff', 'searchoff'],
    description: 'Disable the web search tool.',
    category: 'Configuration',
    ephemeral: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { webSearchEnabled: false });
        await commandUtils.reply(ctx.message, 'Web search is now DISABLED.');
    }
};

/**
 * !websearchmax N - Cap maximum web searches per response
 */
export const webSearchMaxCommand: Command = {
    names: ['websearchmax', 'searchmax'],
    description: 'Cap the maximum web searches per response (1–20).',
    category: 'Configuration',
    ephemeral: true,
    options: [{ name: 'count', description: 'Max searches per response (1–20)', type: 'integer', required: true }],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const n = Number(ctx.args[0]);
        if (!Number.isInteger(n) || n < 1 || n > 20) {
            await commandUtils.reply(
                ctx.message,
                'Failed to parse value. Format: `!websearchmax N` where N is an integer between 1 and 20.'
            );
            return;
        }
        deps.state.updateConfig(ctx.id, ctx.isDM, { webSearchMaxUses: n });
        await commandUtils.reply(ctx.message, `Max web searches per response set to ${n}.`);
    }
};

// Export all config commands
export const configCommands: Command[] = [
    helpCommand,
    clearCommand,
    logCommand,
    temperatureCommand,
    modelCommand,
    delayCommand,
    tokensCommand,
    speedScalarCommand,
    limitCommand,
    persistCommand,
    dmsCommand,
    voiceOnCommand,
    voiceOffCommand,
    thinkOnCommand,
    thinkOffCommand,
    webSearchOnCommand,
    webSearchOffCommand,
    webSearchMaxCommand
];
