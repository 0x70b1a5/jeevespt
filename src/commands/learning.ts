import { Message, TextChannel, DMChannel } from 'discord.js';
import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils } from './utils';
import { buildListMessage, registerListKind } from './listPanel';
import { generateText } from '../llm/generate';
import { LEARNING_PROMPT_TEMPLATE } from '../prompts/prompts';

/** Learning subjects, with today's progress above and a ❌ per subject. */
export const learningList = registerListKind({
    code: 'learn',
    command: 'learning',
    title: '📚 Learning',
    empty: 'No subjects yet. Add one with `/learning subject:Latin`.',
    header: (deps, scope) => {
        const config = deps.state.getConfig(scope.id, scope.isDM);
        const lines = [`Questions are **${config.learningEnabled ? 'on' : 'off'}** (toggle in \`/settings\` → Features).`];
        if (config.learningEnabled && config.learningSubjects.length > 0) {
            lines.push(`Spaced through the day: every ${Math.round(24 / config.learningSubjects.length * 10) / 10}h per subject.`);
            const next = deps.state.getNextQuestionSubject(scope.id, scope.isDM, config.learningSubjects);
            if (next) {
                lines.push(`⏰ Next: **${next}** (ready now)`);
            } else {
                const wait = deps.state.getTimeUntilNextQuestion(scope.id, scope.isDM, config.learningSubjects);
                if (wait < Infinity) {
                    lines.push(`⏰ Next question in ${Math.floor(wait / 3_600_000)}h ${Math.floor((wait % 3_600_000) / 60_000)}m`);
                }
            }
        }
        return lines.join('\n');
    },
    entries: (deps, scope) => {
        const tracker = deps.state.getLearningTracker(scope.id, scope.isDM);
        return deps.state.getConfig(scope.id, scope.isDM).learningSubjects.map(subject => {
            const count = tracker.dailyQuestionCount.get(subject) || 0;
            const last = tracker.lastQuestionTimes.get(subject);
            return {
                value: subject,
                text: `**${subject}** — ${count} today${last ? `, last <t:${Math.floor(last / 1000)}:R>` : ''}`
            };
        });
    },
    remove: (deps, scope, entry) => {
        const config = deps.state.getConfig(scope.id, scope.isDM);
        deps.state.updateConfig(scope.id, scope.isDM, {
            learningSubjects: config.learningSubjects.filter(s => s !== entry.value)
        });
    }
});

/**
 * !learning [subject] — show subjects and progress (❌ to remove), or add one.
 */
export const learningCommand: Command = {
    names: ['learning'],
    description: 'Learning subjects and progress; give a subject to add it (remove with buttons).',
    category: 'Learning',
    options: [{ name: 'subject', description: 'Subject to add (e.g. Latin)', type: 'string', required: false, rest: true }],
    examples: ['!learning', '!learning Ancient Greek'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const scope = { id: ctx.id, isDM: ctx.isDM, ownerId: ctx.message.author.id };
        const subject = ctx.args.join(' ').trim();
        let note: string | undefined;
        if (subject) {
            const config = deps.state.getConfig(ctx.id, ctx.isDM);
            if (config.learningSubjects.includes(subject)) {
                note = `**${subject}** is already on the list.`;
            } else {
                deps.state.updateConfig(ctx.id, ctx.isDM, { learningSubjects: [...config.learningSubjects, subject] });
                note = `✅ Added **${subject}**`;
            }
        }
        await ctx.message.reply(buildListMessage(learningList, deps, scope, note));
    }
};

/**
 * !learn - Trigger a learning question immediately
 * Note: This needs special handling in CommandHandler because it requires generateResponse
 */
export const learnCommand: Command = {
    names: ['learn'],
    description: 'Ask a learning question right now from your subjects.',
    category: 'Learning',
    deferred: true,
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

        const result = await generateText(
            { anthropic: deps.anthropic, xai: deps.xai, poolside: deps.poolside },
            {
                model: config.model,
                maxTokens: 300,
                temperature: config.temperature,
                messages: [{
                    role: 'user',
                    content: `Create a question for the following subject: ${subject}`
                }],
                system: learningPrompt
            }
        );

        const questionText = result.content || '';

        if (questionText) {
            // Chat history is read from the channel, so the bot will see
            // that it asked this when someone answers.
            await commandUtils.sendWebhookMessage(channel, questionText, config.mode);
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
export const learningCommands: Command[] = [learningCommand]; // learnCommand is handled specially
