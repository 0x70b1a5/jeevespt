import { Message, TextChannel, DMChannel } from 'discord.js';
import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils } from './utils';
import { LEARNING_PROMPT_TEMPLATE } from '../prompts/prompts';

/**
 * !learnon - Enable learning questions
 */
export const learnOnCommand: Command = {
    names: ['learnon'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { learningEnabled: true });
        await commandUtils.reply(
            ctx.message,
            `Learning questions enabled for ${ctx.isDM ? 'DMs' : 'this server'}.`
        );
    }
};

/**
 * !learnoff - Disable learning questions
 */
export const learnOffCommand: Command = {
    names: ['learnoff'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { learningEnabled: false });
        await commandUtils.reply(
            ctx.message,
            `Learning questions disabled for ${ctx.isDM ? 'DMs' : 'this server'}.`
        );
    }
};

/**
 * !learnadd - Add a learning subject
 */
export const learnAddCommand: Command = {
    names: ['learnadd'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const subject = ctx.args.join(' ');

        if (!subject.trim()) {
            await commandUtils.reply(ctx.message, 'Please specify a subject to add. Usage: !learnadd [subject]');
            return;
        }

        const config = deps.state.getConfig(ctx.id, ctx.isDM);
        const subjectTrimmed = subject.trim();

        if (config.learningSubjects.includes(subjectTrimmed)) {
            await commandUtils.reply(ctx.message, `"${subjectTrimmed}" is already in the learning subjects list.`);
            return;
        }

        const newSubjects = [...config.learningSubjects, subjectTrimmed];
        deps.state.updateConfig(ctx.id, ctx.isDM, { learningSubjects: newSubjects });

        await commandUtils.reply(
            ctx.message,
            `Added "${subjectTrimmed}" to learning subjects.\n` +
            `Current subjects: ${newSubjects.join(', ')}\n` +
            `Questions will be spaced throughout the day (every ${Math.round(24 / newSubjects.length * 10) / 10} hours per subject).`
        );
    }
};

/**
 * !learnremove - Remove a learning subject
 */
export const learnRemoveCommand: Command = {
    names: ['learnremove'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const subject = ctx.args.join(' ');

        if (!subject.trim()) {
            await commandUtils.reply(ctx.message, 'Please specify a subject to remove. Usage: !learnremove [subject]');
            return;
        }

        const config = deps.state.getConfig(ctx.id, ctx.isDM);
        const subjectTrimmed = subject.trim();

        if (!config.learningSubjects.includes(subjectTrimmed)) {
            await commandUtils.reply(
                ctx.message,
                `"${subjectTrimmed}" is not in the learning subjects list.\n` +
                `Current subjects: ${config.learningSubjects.join(', ') || 'none'}`
            );
            return;
        }

        const newSubjects = config.learningSubjects.filter(s => s !== subjectTrimmed);
        deps.state.updateConfig(ctx.id, ctx.isDM, { learningSubjects: newSubjects });

        await commandUtils.reply(
            ctx.message,
            `Removed "${subjectTrimmed}" from learning subjects.\n` +
            `Current subjects: ${newSubjects.join(', ') || 'none'}` +
            (newSubjects.length > 0 ? `\nQuestions will be spaced throughout the day (every ${Math.round(24 / newSubjects.length * 10) / 10} hours per subject).` : '')
        );
    }
};

/**
 * !learnstatus - Show learning status
 */
export const learnStatusCommand: Command = {
    names: ['learnstatus'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const config = deps.state.getConfig(ctx.id, ctx.isDM);
        const tracker = deps.state.getLearningTracker(ctx.id, ctx.isDM);

        let status = `📚 **Learning System Status:**\n`;
        status += `🔹 Enabled: ${config.learningEnabled ? '✅' : '❌'}\n`;
        status += `🔹 Subjects: ${config.learningSubjects.join(', ') || 'none'}\n\n`;

        if (config.learningEnabled && config.learningSubjects.length > 0) {
            status += `📊 **Today's Questions:**\n`;
            for (const subject of config.learningSubjects) {
                const count = tracker.dailyQuestionCount.get(subject) || 0;
                const lastTime = tracker.lastQuestionTimes.get(subject);
                const lastTimeStr = lastTime ? new Date(lastTime).toLocaleTimeString() : 'never';
                status += `🔸 ${subject}: ${count} questions (last: ${lastTimeStr})\n`;
            }

            const nextSubject = deps.state.getNextQuestionSubject(ctx.id, ctx.isDM, config.learningSubjects);
            if (nextSubject) {
                status += `\n⏰ Next question: ${nextSubject} (ready now!)`;
            } else {
                const timeUntilNext = deps.state.getTimeUntilNextQuestion(ctx.id, ctx.isDM, config.learningSubjects);
                if (timeUntilNext < Infinity) {
                    const hours = Math.floor(timeUntilNext / (1000 * 60 * 60));
                    const minutes = Math.floor((timeUntilNext % (1000 * 60 * 60)) / (1000 * 60));
                    status += `\n⏰ Next question in: ${hours}h ${minutes}m`;
                }
            }
        }

        await ctx.message.reply(status);
    }
};

/**
 * !learn - Trigger a learning question immediately
 * Note: This needs special handling in CommandHandler because it requires generateResponse
 */
export const learnCommand: Command = {
    names: ['learn'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        // This will be handled by CommandHandler directly
        throw new Error('Learn command must be handled by CommandHandler directly');
    }
};

/**
 * Learning question generator - used by CommandHandler and server
 */
export async function performLearningQuestion(
    channel: TextChannel | DMChannel,
    id: string,
    isDM: boolean,
    subject: string,
    deps: CommandDependencies
): Promise<void> {
    console.log(`📚 Generating learning question for ${isDM ? 'user' : 'guild'}: ${id}, subject: ${subject}`);

    try {
        const config = deps.state.getConfig(id, isDM);
        const learningPrompt = LEARNING_PROMPT_TEMPLATE.replace('{SUBJECT}', subject);

        const response = await deps.anthropic.messages.create({
            model: config.model,
            max_tokens: 300,
            temperature: config.temperature,
            messages: [{
                role: 'user',
                content: `Create a question for the following subject: ${subject}`
            }],
            system: learningPrompt
        });

        const questionText = response.content[0]?.type === 'text' ? response.content[0].text : '';

        if (questionText) {
            const questionMessage = {
                role: 'assistant',
                content: questionText
            };

            // Add to log so bot remembers asking this question
            const log = deps.state.getLog(id, isDM);
            log.messages.push(questionMessage);

            if (log.messages.length > config.messageLimit) {
                log.messages = log.messages.slice(-config.messageLimit);
            }

            await commandUtils.sendWebhookMessage(channel, questionMessage.content, config.mode);
            console.log(`✅ Posted learning question for ${subject}`);
        } else {
            console.error('Failed to generate learning question - empty response');
            await channel.send(`[SYSTEM] Sorry, I couldn't generate a learning question right now.`);
        }
    } catch (error) {
        console.error('Error generating learning question:', error);
        await channel.send(`[SYSTEM] Error generating learning question: ${error}`);
    }
}

// Export all learning commands
export const learningCommands: Command[] = [
    learnOnCommand,
    learnOffCommand,
    learnAddCommand,
    learnRemoveCommand,
    learnStatusCommand
    // learnCommand is handled specially
];
