import { Anthropic } from '@anthropic-ai/sdk';
import { ScheduledTask, TaskRecurrence } from '../state/types';
import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils, discordTimestamp } from './utils';
import { TASK_PARSER_MODEL } from './constants';

/**
 * Shape returned by the LLM parser.
 * Either an error or a parsed task descriptor.
 */
type ParsedTask =
    | {
        recurring: false;
        firstRun: string;
        instructions: string;
        rawScheduleText: string;
    }
    | {
        recurring: true;
        firstRun: string;
        recurrence: TaskRecurrence;
        instructions: string;
        rawScheduleText: string;
    };

type ParseResult = ParsedTask | { error: string };

/**
 * Compute the next run time for a recurring task, strictly after `from`.
 *
 * Note: uses host-local timezone semantics (Date setters operate in local TZ).
 * If multi-TZ support is needed later, store a tzid on the task and resolve here.
 */
export function computeNextRun(recurrence: TaskRecurrence, from: Date): Date {
    if (recurrence.type === 'interval') {
        return new Date(from.getTime() + recurrence.intervalMs);
    }

    if (recurrence.type === 'daily') {
        const next = new Date(from);
        next.setHours(recurrence.hour, recurrence.minute, 0, 0);
        if (next <= from) {
            next.setDate(next.getDate() + 1);
        }
        return next;
    }

    if (recurrence.type === 'weekly') {
        const next = new Date(from);
        next.setHours(recurrence.hour, recurrence.minute, 0, 0);
        const currentDow = next.getDay();
        let diff = (recurrence.dayOfWeek - currentDow + 7) % 7;
        if (diff === 0 && next <= from) {
            diff = 7;
        }
        next.setDate(next.getDate() + diff);
        return next;
    }

    // monthly — clamp dayOfMonth to month length so "31st" survives February
    const next = new Date(from);
    next.setHours(recurrence.hour, recurrence.minute, 0, 0);
    const clampToMonth = (d: Date, day: number) => {
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, lastDay));
    };
    clampToMonth(next, recurrence.dayOfMonth);
    if (next <= from) {
        next.setMonth(next.getMonth() + 1, 1);
        clampToMonth(next, recurrence.dayOfMonth);
    }
    return next;
}

const PARSER_SYSTEM_PROMPT = `You parse natural-language scheduled-task commands. The user gives a single free-form string that combines (a) WHEN the task should run and (b) WHAT an agent should do at that time.

Output strict JSON only — no markdown, no prose, no code fences.

If the input is unparseable, output: {"error":"<short reason>"}

Otherwise output one of:

One-shot:
{
  "recurring": false,
  "firstRun": "<ISO 8601 timestamp>",
  "instructions": "<the task to do, with scheduling words removed>",
  "rawScheduleText": "<short human-readable summary of when>"
}

Recurring (add "recurrence", which is one of):
  {"type":"interval","intervalMs":<number>}
  {"type":"daily","hour":0-23,"minute":0-59}
  {"type":"weekly","dayOfWeek":0-6,"hour":0-23,"minute":0-59}   // 0=Sun, 6=Sat
  {"type":"monthly","dayOfMonth":1-31,"hour":0-23,"minute":0-59}

Rules:
- If no time of day is given, default to 09:00 local time.
- "This <weekday>" / "tomorrow" / "next Friday" → one-shot.
- "Every <weekday>" → weekly. "Every day" → daily. "Every other day" / "every N days" → interval with intervalMs = N * 86400000, firstRun = today (or the next occurrence of the specified time, if it has already passed).
- "instructions" must contain only the actual task, with no scheduling words.
- "rawScheduleText" is a brief human-readable label (e.g. "every Saturday at 8am").
- firstRun must always be strictly in the future relative to the current time.`;

/**
 * Parse a free-form task command via Claude.
 *
 * Returns either a structured task descriptor or an error object.
 */
export async function parseTaskWithLLM(
    raw: string,
    now: Date,
    anthropic: Anthropic
): Promise<ParseResult> {
    const userPrompt = `Current time: ${now.toISOString()} (interpret times relative to this).\n\nInput:\n${raw}`;

    let text: string;
    try {
        const completion = await anthropic.messages.create({
            model: TASK_PARSER_MODEL,
            max_tokens: 800,
            system: PARSER_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }]
        });

        const block = completion.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
        if (!block) return { error: 'Parser returned no text.' };
        text = block.text.trim();
    } catch (err: any) {
        console.error('Task parser API error:', err);
        return { error: 'Could not reach the parser model.' };
    }

    // Strip code fences if the model added them despite instructions.
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fenced) text = fenced[1].trim();

    let parsed: any;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { error: `Parser output was not valid JSON: ${text.slice(0, 200)}` };
    }

    if (parsed && typeof parsed.error === 'string') {
        return { error: parsed.error };
    }

    const validationErr = validateParsed(parsed, now);
    if (validationErr) return { error: validationErr };

    return parsed as ParsedTask;
}

function validateParsed(p: any, now: Date): string | null {
    if (!p || typeof p !== 'object') return 'Parser output is not an object.';
    if (typeof p.firstRun !== 'string') return 'Missing firstRun.';
    if (typeof p.instructions !== 'string' || !p.instructions.trim()) return 'Missing instructions.';
    if (typeof p.rawScheduleText !== 'string') return 'Missing rawScheduleText.';

    const firstRunDate = new Date(p.firstRun);
    if (isNaN(firstRunDate.getTime())) return 'firstRun is not a valid date.';
    if (firstRunDate.getTime() <= now.getTime()) return 'firstRun is not in the future.';

    if (p.recurring === true) {
        const r = p.recurrence;
        if (!r || typeof r !== 'object') return 'Missing recurrence for recurring task.';
        switch (r.type) {
            case 'interval':
                if (typeof r.intervalMs !== 'number' || r.intervalMs < 60_000) {
                    return 'interval.intervalMs must be a number ≥ 60000.';
                }
                break;
            case 'daily':
                if (!isHour(r.hour) || !isMinute(r.minute)) return 'daily needs valid hour/minute.';
                break;
            case 'weekly':
                if (!Number.isInteger(r.dayOfWeek) || r.dayOfWeek < 0 || r.dayOfWeek > 6) return 'weekly.dayOfWeek out of range.';
                if (!isHour(r.hour) || !isMinute(r.minute)) return 'weekly needs valid hour/minute.';
                break;
            case 'monthly':
                if (!Number.isInteger(r.dayOfMonth) || r.dayOfMonth < 1 || r.dayOfMonth > 31) return 'monthly.dayOfMonth out of range.';
                if (!isHour(r.hour) || !isMinute(r.minute)) return 'monthly needs valid hour/minute.';
                break;
            default:
                return `Unknown recurrence type: ${r.type}`;
        }
    } else if (p.recurring !== false) {
        return 'recurring must be true or false.';
    }

    return null;
}

const isHour = (n: any) => Number.isInteger(n) && n >= 0 && n <= 23;
const isMinute = (n: any) => Number.isInteger(n) && n >= 0 && n <= 59;

function describeRecurrence(t: ScheduledTask): string {
    if (!t.recurrence) return `one-shot — ${t.rawScheduleText}`;
    return `recurring — ${t.rawScheduleText}`;
}

/**
 * !task — Schedule an agent to run at a future time (one-shot or recurring).
 */
export const taskCommand: Command = {
    names: ['task'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const raw = ctx.args.join(' ').trim();
        if (!raw) {
            await commandUtils.reply(
                ctx.message,
                `Usage: \`!task <when + what to do>\`
Examples:
- \`!task every Saturday at 8am check example.com and let me know if it has an elephant on it\`
- \`!task this Saturday check whether a retreat is happening at https://example-church.org\`
- \`!task every other day find the lowest gas prices in 90210\`
- \`!task tomorrow at noon summarize the top stories on Hacker News\``
            );
            return;
        }

        const now = new Date();
        const parsed = await parseTaskWithLLM(raw, now, deps.anthropic);

        if ('error' in parsed) {
            await commandUtils.reply(ctx.message, `Couldn't parse that: ${parsed.error}`);
            return;
        }

        const task: ScheduledTask = {
            id: `${ctx.message.author.id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            userId: ctx.message.author.id,
            channelId: ctx.message.channel.id,
            isDM: ctx.isDM,
            instructions: parsed.instructions,
            rawScheduleText: parsed.rawScheduleText,
            nextRun: new Date(parsed.firstRun),
            recurrence: parsed.recurring ? parsed.recurrence : undefined,
            createdAt: now,
            consecutiveFailures: 0,
            paused: false
        };

        deps.state.addTask(task);

        const kind = task.recurrence ? '🔁 Recurring task' : '📋 One-shot task';
        await commandUtils.reply(
            ctx.message,
            `${kind} set for ${discordTimestamp(task.nextRun, 'f')} (${discordTimestamp(task.nextRun, 'R')})\n` +
            `🗓️  ${task.rawScheduleText}\n` +
            `📝 ${task.instructions}\n` +
            `🆔 \`${task.id}\``
        );
    }
};

/**
 * !tasks — List the caller's active scheduled tasks.
 */
export const tasksCommand: Command = {
    names: ['tasks'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const userTasks = deps.state.getTasksForUser(ctx.message.author.id);
        if (userTasks.length === 0) {
            await commandUtils.reply(ctx.message, 'You have no active tasks.');
            return;
        }

        const sorted = userTasks.sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime());
        const lines = sorted.map(t => {
            const status: string[] = [];
            if (t.paused) status.push('⏸️ paused');
            if (t.consecutiveFailures > 0 && !t.paused) status.push(`⚠️ ${t.consecutiveFailures} recent failure(s)`);
            const statusStr = status.length ? `  _${status.join(', ')}_\n` : '';
            return `${t.recurrence ? '🔁' : '📋'} ${describeRecurrence(t)}\n` +
                `  next: ${discordTimestamp(t.nextRun, 'f')} (${discordTimestamp(t.nextRun, 'R')})\n` +
                `  📝 ${t.instructions}\n` +
                statusStr +
                `  🆔 \`${t.id}\``;
        });

        const reply = lines.join('\n\n');
        const chunks = commandUtils.splitMessageIntoChunks([{ role: 'user', content: reply }]);
        await commandUtils.reply(ctx.message, 'Your active tasks:');
        const channel = ctx.message.channel as any;
        if (channel && typeof channel.send === 'function') {
            for (const chunk of chunks) {
                if (chunk) await channel.send(chunk);
            }
        }
    }
};

/**
 * !canceltask <id> — Cancel a specific task.
 */
export const cancelTaskCommand: Command = {
    names: ['canceltask'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const id = ctx.args[0];
        if (!id) {
            await commandUtils.reply(ctx.message, 'Usage: `!canceltask <task_id>`');
            return;
        }

        const task = deps.state.getTask(id);
        if (!task) {
            await commandUtils.reply(ctx.message, `Task not found: \`${id}\``);
            return;
        }
        if (task.userId !== ctx.message.author.id) {
            await commandUtils.reply(ctx.message, 'You can only cancel your own tasks.');
            return;
        }

        deps.state.removeTask(id);
        await commandUtils.reply(
            ctx.message,
            `✅ Cancelled task:\n📝 ${task.instructions}\n🗓️ Was: ${task.rawScheduleText}`
        );
    }
};

export const taskCommands: Command[] = [taskCommand, tasksCommand, cancelTaskCommand];
