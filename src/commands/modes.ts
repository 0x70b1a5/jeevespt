import { Command, CommandContext, CommandDependencies } from './types';
import { MODE_RESPONSES, SYS_PREFIX } from './constants';
import { commandUtils } from './utils';
import { BotMode } from '../bot';

/**
 * Create a mode switch command
 */
function createModeCommand(mode: BotMode, description: string, category = 'Modes'): Command {
    return {
        names: [mode],
        description,
        category,
        ephemeral: true,
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
export const jeevesCommand = createModeCommand('jeeves', 'Act like Jeeves, the cultured butler. Clears memory.');

/**
 * !tokipona - Switch to toki pona mode
 */
export const tokiponaCommand = createModeCommand('tokipona', 'Speak only toki pona, for language immersion. Clears memory.');

/**
 * !whisper - Switch to transcription mode
 */
export const whisperCommand = createModeCommand('whisper', 'Transcription-only mode: reply to audio with text, no AI chat.', 'Transcription');

/**
 * !lugso - Switch to Lugso mode
 */
export const lugsoCommand = createModeCommand('lugso', 'Switch to the Lugso persona. Clears memory.');

/**
 * !prompt - Set custom prompt
 */
export const promptCommand: Command = {
    names: ['prompt'],
    description: 'Set a custom system prompt (the AI\'s personality). Clears memory. Accepts text or a text-file attachment.',
    category: 'Modes',
    ephemeral: true,
    options: [{ name: 'text', description: 'The system prompt text', type: 'string', required: false, rest: true }],
    examples: ['!prompt You are a laconic noir detective.'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        let prompt = ctx.args.join(' ');

        // Check for text file attachments and extract their contents
        for (const [, attachment] of ctx.message.attachments) {
            if (commandUtils.isTextFileAttachment(attachment)) {
                try {
                    console.log(`🔍 Processing text file for prompt: ${attachment.name}`);
                    const fileContent = await commandUtils.downloadAndReadTextFile(
                        attachment.url,
                        `prompt_${ctx.message.author.id}_${Date.now()}.txt`
                    );
                    const body = commandUtils.formatTextAttachment(attachment, fileContent);
                    // Prepend or use file content as prompt
                    prompt = prompt ? `${prompt}\n\n${body}` : body;
                } catch (error) {
                    console.error(`❌ Error reading text file ${attachment.name}:`, error);
                    await commandUtils.replyError(ctx.message, `Could not read file: ${attachment.name}`);
                    return;
                }
            } else if (commandUtils.isTextLikeAttachment(attachment)) {
                await commandUtils.replyError(
                    ctx.message,
                    `File too large to read as a prompt: ${attachment.name} (${attachment.size} bytes).`
                );
                return;
            }
        }

        if (!prompt.trim()) {
            await commandUtils.replyError(ctx.message, 'Please provide a prompt text or attach a text file.');
            return;
        }

        const log = deps.state.getLog(ctx.id, ctx.isDM);
        log.messages = [];
        deps.state.updateConfig(ctx.id, ctx.isDM, { mode: 'customprompt' });
        deps.state.setCustomPrompt(ctx.id, ctx.isDM, prompt);

        const charCount = prompt.length >= 1000
            ? `${Math.round(prompt.length / 1000)}k`
            : prompt.length.toString();
        await commandUtils.reply(ctx.message, `Prompt set (${charCount} chars).`);
    }
};

// Export all mode commands
export const modeCommands: Command[] = [
    jeevesCommand,
    tokiponaCommand,
    whisperCommand,
    promptCommand,
    lugsoCommand
];
