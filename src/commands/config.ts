import { Command, CommandContext, CommandDependencies } from './types';
import { SYS_PREFIX, MODEL_CACHE_DURATION } from './constants';
import { commandUtils } from './utils';
import { VALID_ANTHROPIC_MODELS } from '../bot';
import { help } from '../help';

/**
 * !help - Display help information
 */
export const helpCommand: Command = {
    names: ['help'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const config = deps.state.getConfig(ctx.id, ctx.isDM);
        const helpTexts = [
            `# JEEVESPT
- Remembers the last ${config.messageLimit} messages
- Temperature: ${config.temperature}
- Model: ${config.model}
- Response delay: ${config.responseDelayMs / 1000} seconds
- Muse interval: ${config.museInterval / 60 / 60 / 1000} hours
- Automatic muse: ${config.shouldMuseRegularly ? 'enabled' : 'disabled'}
- Current mode: \`${config.mode}\`
- Max response length (tokens): ${config.maxResponseLength}
- Persist data: ${config.shouldSaveData ? 'enabled' : 'disabled'}
- Direct messages: ${config.allowDMs ? 'enabled' : 'disabled'}
- Transcription speed scalar: ${config.transcriptionSpeedScalar}x`,
            ...help
        ];

        for (const text of helpTexts) {
            await ctx.message.channel.send(text);
        }
    }
};

/**
 * !clear - Clear message history
 */
export const clearCommand: Command = {
    names: ['clear'],
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
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const log = deps.state.getLog(ctx.id, ctx.isDM);
        const logAsString = JSON.stringify(log.messages, null, 2);
        const chunks = commandUtils.splitMessageIntoChunks([{ role: 'assistant', content: logAsString }]);

        await commandUtils.reply(ctx.message, 'CURRENT MEMORY:\n---');
        for (const chunk of chunks) {
            if (chunk) await ctx.message.channel.send(chunk);
        }
        await ctx.message.channel.send(`${SYS_PREFIX}---`);
    }
};

/**
 * !temperature - Set AI temperature
 */
export const temperatureCommand: Command = {
    names: ['temperature'],
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
 * Model list cache for API validation
 */
let modelListCache: string[] | null = null;
let modelListCacheTime = 0;

async function getValidModels(): Promise<string[]> {
    const now = Date.now();
    if (modelListCache && (now - modelListCacheTime) < MODEL_CACHE_DURATION) {
        return modelListCache;
    }

    try {
        const response = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY || '',
                'anthropic-version': '2023-06-01'
            }
        });

        if (response.ok) {
            const data = await response.json() as { data: Array<{ id: string }> };
            modelListCache = data.data.map(model => model.id);
            modelListCacheTime = now;
            console.log(`✅ Fetched ${modelListCache.length} models from Anthropic API`);
            return modelListCache;
        } else {
            console.warn(`⚠️ Failed to fetch models from API (${response.status}), using static list`);
            return [...VALID_ANTHROPIC_MODELS];
        }
    } catch (error) {
        console.warn(`⚠️ Error fetching models from API, using static list:`, error);
        return [...VALID_ANTHROPIC_MODELS];
    }
}

/**
 * !model - Set or list AI models
 */
export const modelCommand: Command = {
    names: ['model'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const modelName = ctx.args[0];

        if (!modelName) {
            const validModels = await getValidModels();
            const currentConfig = deps.state.getConfig(ctx.id, ctx.isDM);
            const modelList = validModels
                .map(m => `• \`${m}\`${m === currentConfig.model ? ' ⭐ (current)' : ''}`)
                .join('\n');

            await commandUtils.reply(
                ctx.message,
                `**Available Anthropic models:**\n${modelList}\n\nUse \`!model <model_name>\` to switch models.`
            );
            return;
        }

        const validModels = await getValidModels();
        const isValidModel = validModels.includes(modelName);

        deps.state.updateConfig(ctx.id, ctx.isDM, { model: modelName });

        if (!isValidModel) {
            const modelList = validModels.map(m => `• \`${m}\``).join('\n');
            await commandUtils.reply(
                ctx.message,
                `Model set to \`${modelName}\`.\n\n` +
                `**⚠️ Warning:** \`${modelName}\` is not a recognized Anthropic model. ` +
                `This may be fine for testing purposes, but using an invalid model will cause the bot to fail when generating responses.\n\n` +
                `**Valid Anthropic models:**\n${modelList}`
            );
        } else {
            await commandUtils.reply(ctx.message, `Model set to \`${modelName}\`.`);
        }
    }
};

/**
 * !delay - Set response delay
 */
export const delayCommand: Command = {
    names: ['delay'],
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
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { useVoiceResponse: true });
        await commandUtils.reply(ctx.message, 'Voice responses are now ENABLED.');
    }
};

export const voiceOffCommand: Command = {
    names: ['voiceoff'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { useVoiceResponse: false });
        await commandUtils.reply(ctx.message, 'Voice responses are now DISABLED.');
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
    voiceOffCommand
];
