import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils, isAdmin } from './utils';
import { registry } from './registry';
import { buildListMessage, registerListKind } from './listPanel';

/** Commands non-admins may still use while admin mode is on; ❌ removes (admins only). */
export const whitelistList = registerListKind({
    code: 'wl',
    command: 'whitelist',
    title: '🛡️ Command whitelist',
    requiresAdmin: true,
    empty: 'No commands are whitelisted.',
    header: (deps, scope) => {
        const on = deps.state.getConfig(scope.id, scope.isDM).adminMode;
        return `Admin mode is **${on ? 'on' : 'off'}** (toggle in \`/settings\` → Admin). ` +
            (on ? 'Only administrators may run commands, except these:' : 'While it is off, everyone may run every command.');
    },
    entries: (deps, scope) => deps.state.getConfig(scope.id, scope.isDM).commandWhitelist.map(c => ({
        value: c,
        text: `\`${c}\``
    })),
    remove: (deps, scope, entry) => {
        const config = deps.state.getConfig(scope.id, scope.isDM);
        deps.state.updateConfig(scope.id, scope.isDM, {
            commandWhitelist: config.commandWhitelist.filter(c => c !== entry.value)
        });
    }
});

/**
 * !whitelist [command] — show the admin-mode whitelist (❌ to remove), or add
 * a command to it. Changing it requires a server administrator.
 */
export const whitelistCommand: Command = {
    names: ['whitelist'],
    requiresGuild: true,
    description: 'Commands non-admins may use in admin mode; give one to add it (admins only).',
    category: 'Admin',
    options: [{ name: 'command', description: 'Command name to allow (e.g. settings)', type: 'string', required: false }],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const scope = { id: ctx.id, isDM: ctx.isDM, ownerId: ctx.message.author.id };
        const commandName = ctx.args[0]?.toLowerCase().replace(/^[!/]/, '');
        let note: string | undefined;

        if (commandName) {
            if (!isAdmin(ctx.message)) {
                await commandUtils.reply(ctx.message, 'You must be a server administrator to change the whitelist.');
                return;
            }
            if (!registry.has(commandName)) {
                await commandUtils.reply(ctx.message, `Command \`${commandName}\` does not exist.`);
                return;
            }
            const config = deps.state.getConfig(ctx.id, ctx.isDM);
            if (config.commandWhitelist.some(c => c.toLowerCase() === commandName)) {
                note = `\`${commandName}\` is already whitelisted.`;
            } else {
                deps.state.updateConfig(ctx.id, ctx.isDM, { commandWhitelist: [...config.commandWhitelist, commandName] });
                note = `✅ Added \`${commandName}\``;
            }
        }
        await ctx.message.reply(buildListMessage(whitelistList, deps, scope, note));
    }
};

/**
 * !redeploy - Pull the latest code and restart the bot.
 *
 * Works by exiting the process: the run.sh supervisor loop in the bot's tmux
 * window does the git pull and restart. If the bot was launched without
 * run.sh, this just stops it — someone with shell access must start it again.
 */
export const redeployCommand: Command = {
    names: ['redeploy'],
    requiresGuild: true,
    description: 'Pull the latest code and restart the bot (admin only).',
    category: 'Admin',
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        if (!isAdmin(ctx.message)) {
            await commandUtils.reply(ctx.message, 'You must be a server administrator to use this command.');
            return;
        }

        await commandUtils.reply(ctx.message, 'Redeploying: pulling the latest code and restarting. Back in a moment, sir.');
        console.log(`🔁 Redeploy requested by ${ctx.message.author.tag} — exiting so the supervisor restarts with fresh code`);
        // Brief pause so the reply reliably lands before the process dies
        setTimeout(() => process.exit(0), 1500);
    }
};

// Export all admin commands
export const adminCommands: Command[] = [
    whitelistCommand,
    redeployCommand
];
