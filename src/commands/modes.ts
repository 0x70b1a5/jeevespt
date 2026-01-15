import { Command, CommandContext, CommandDependencies } from './types';
import { MODE_RESPONSES, SYS_PREFIX } from './constants';
import { commandUtils } from './utils';
import { BotMode } from '../bot';

/**
 * Create a mode switch command
 */
function createModeCommand(mode: BotMode): Command {
    return {
        names: [mode],
        async execute(ctx: CommandContext, deps: CommandDependencies) {
            deps.state.getLog(ctx.id, ctx.isDM).messages = [];
            deps.state.updateConfig(ctx.id, ctx.isDM, { mode });

            const response = MODE_RESPONSES[mode] || 'Mode changed.';
            await commandUtils.reply(ctx.message, response);
        }
    };
}

/**
 * !jeeves - Switch to Jeeves mode
 */
export const jeevesCommand = createModeCommand('jeeves');

/**
 * !tokipona - Switch to toki pona mode
 */
export const tokiponaCommand = createModeCommand('tokipona');

/**
 * !whisper - Switch to transcription mode
 */
export const whisperCommand = createModeCommand('whisper');

/**
 * !prompt - Set custom prompt
 */
export const promptCommand: Command = {
    names: ['prompt'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const prompt = ctx.args.join(' ');
        const log = deps.state.getLog(ctx.id, ctx.isDM);
        log.messages = [];
        deps.state.updateConfig(ctx.id, ctx.isDM, { mode: 'customprompt' });
        deps.state.setCustomPrompt(ctx.id, ctx.isDM, prompt);

        await commandUtils.reply(ctx.message, 'Prompt set to:');
        const chunks = commandUtils.splitMessageIntoChunks([{ role: 'user', content: prompt }]);
        for (const chunk of chunks) {
            if (chunk) await ctx.message.channel.send(chunk);
        }
    }
};

// Export all mode commands
export const modeCommands: Command[] = [
    jeevesCommand,
    tokiponaCommand,
    whisperCommand,
    promptCommand
];
