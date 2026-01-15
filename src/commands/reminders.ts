import { Command, CommandContext, CommandDependencies } from './types';
import { TIME_MULTIPLIERS, MIN_REMINDER_MS, MAX_REMINDER_MS } from './constants';
import { commandUtils } from './utils';

/**
 * Format time remaining in human-readable format
 */
function formatTimeLeft(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

/**
 * !remind - Add a reminder
 */
export const remindCommand: Command = {
    names: ['remind'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        if (ctx.args.length < 2) {
            await commandUtils.reply(
                ctx.message,
                `Usage: \`!remind <time> <message>\`
Examples:
- \`!remind 5m Take a break\`
- \`!remind 2h Check the laundry\`
- \`!remind 1d Review the proposal\`
- \`!remind 30s Quick test\``
            );
            return;
        }

        const timeStr = ctx.args[0];
        const reminderContent = ctx.args.slice(1).join(' ');

        // Parse time string (e.g., "5m", "2h", "1d", "30s")
        const timeMatch = timeStr.match(/^(\d+)([smhd])$/i);
        if (!timeMatch) {
            await commandUtils.reply(ctx.message, 'Invalid time format. Use: 30s, 5m, 2h, 1d');
            return;
        }

        const [, amount, unit] = timeMatch;
        const delay = parseInt(amount) * TIME_MULTIPLIERS[unit.toLowerCase() as keyof typeof TIME_MULTIPLIERS];
        const triggerTime = new Date(Date.now() + delay);

        // Validate reasonable limits
        if (delay < MIN_REMINDER_MS) {
            await commandUtils.reply(ctx.message, 'Reminder must be at least 10 seconds in the future.');
            return;
        }
        if (delay > MAX_REMINDER_MS) {
            await commandUtils.reply(ctx.message, 'Reminder cannot be more than 1 year in the future.');
            return;
        }

        const reminder = {
            id: `${ctx.message.author.id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            userId: ctx.message.author.id,
            channelId: ctx.message.channel.id,
            content: reminderContent,
            triggerTime,
            isDM: ctx.isDM
        };

        deps.state.addReminder(reminder);

        await commandUtils.reply(
            ctx.message,
            `⏰ Reminder set for ${triggerTime.toLocaleString()}!\n` +
            `📝 "${reminderContent}"\n` +
            `🆔 ID: \`${reminder.id}\``
        );
    }
};

/**
 * !reminders - List active reminders
 */
export const remindersCommand: Command = {
    names: ['reminders'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const userReminders = deps.state.getRemindersForUser(ctx.message.author.id);

        if (userReminders.length === 0) {
            await commandUtils.reply(ctx.message, 'You have no active reminders.');
            return;
        }

        const reminderList = userReminders
            .sort((a, b) => a.triggerTime.getTime() - b.triggerTime.getTime())
            .map(reminder => {
                const timeLeft = reminder.triggerTime.getTime() - Date.now();
                const timeStr = timeLeft > 0
                    ? `in ${formatTimeLeft(timeLeft)}`
                    : 'overdue';

                return `⏰ ${reminder.triggerTime.toLocaleString()} (${timeStr})\n` +
                    `📝 "${reminder.content}"\n` +
                    `🆔 \`${reminder.id}\``;
            })
            .join('\n\n');

        const chunks = commandUtils.splitMessageIntoChunks([{ role: 'user', content: reminderList }]);
        await commandUtils.reply(ctx.message, 'Your active reminders:');

        for (const chunk of chunks) {
            if (chunk) await ctx.message.channel.send(chunk);
        }
    }
};

/**
 * !cancelreminder - Cancel a reminder
 */
export const cancelReminderCommand: Command = {
    names: ['cancelreminder'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const reminderId = ctx.args[0];

        if (!reminderId) {
            await commandUtils.reply(ctx.message, 'Usage: `!cancelreminder <reminder_id>`');
            return;
        }

        const reminder = deps.state.getReminder(reminderId);
        if (!reminder) {
            await commandUtils.reply(ctx.message, `Reminder not found: \`${reminderId}\``);
            return;
        }

        if (reminder.userId !== ctx.message.author.id) {
            await commandUtils.reply(ctx.message, 'You can only cancel your own reminders.');
            return;
        }

        const deleted = deps.state.removeReminder(reminderId);
        if (deleted) {
            await commandUtils.reply(
                ctx.message,
                `✅ Cancelled reminder:\n` +
                `📝 "${reminder.content}"\n` +
                `⏰ Was scheduled for: ${reminder.triggerTime.toLocaleString()}`
            );
        } else {
            await commandUtils.reply(ctx.message, 'Failed to cancel reminder.');
        }
    }
};

// Export all reminder commands
export const reminderCommands: Command[] = [
    remindCommand,
    remindersCommand,
    cancelReminderCommand
];
