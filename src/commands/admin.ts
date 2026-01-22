import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils, isAdmin } from './utils';
import { registry } from './registry';

/**
 * !adminmode - Toggle admin mode on/off
 * When enabled, only admins can run commands (except whitelisted ones)
 */
export const adminModeCommand: Command = {
    names: ['adminmode'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        // This command always requires admin, regardless of adminMode setting
        if (!isAdmin(ctx.message)) {
            await commandUtils.reply(ctx.message, 'You must be a server administrator to use this command.');
            return;
        }

        const config = deps.state.getConfig(ctx.id, ctx.isDM);
        const newValue = !config.adminMode;
        deps.state.updateConfig(ctx.id, ctx.isDM, { adminMode: newValue });

        if (newValue) {
            const whitelistInfo = config.commandWhitelist.length > 0
                ? `Whitelisted commands: ${config.commandWhitelist.map(c => `\`!${c}\``).join(', ')}`
                : 'No commands are whitelisted for non-admins.';
            await commandUtils.reply(
                ctx.message,
                `Admin mode is now **ENABLED**. Only administrators can run commands.\n${whitelistInfo}\n` +
                `Use \`!whitelist <command>\` to allow non-admins to run specific commands.`
            );
        } else {
            await commandUtils.reply(ctx.message, 'Admin mode is now **DISABLED**. All users can run commands.');
        }
    }
};

/**
 * !whitelist <command> - Add a command to the whitelist
 */
export const whitelistCommand: Command = {
    names: ['whitelist'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        if (!isAdmin(ctx.message)) {
            await commandUtils.reply(ctx.message, 'You must be a server administrator to use this command.');
            return;
        }

        const commandName = ctx.args[0]?.toLowerCase().replace(/^!/, '');

        if (!commandName) {
            await commandUtils.reply(ctx.message, 'Usage: `!whitelist <command>` - Add a command to the non-admin whitelist.');
            return;
        }

        // Verify the command exists
        if (!registry.has(commandName)) {
            await commandUtils.reply(ctx.message, `Command \`!${commandName}\` does not exist.`);
            return;
        }

        const config = deps.state.getConfig(ctx.id, ctx.isDM);

        // Check if already whitelisted
        if (config.commandWhitelist.some(c => c.toLowerCase() === commandName)) {
            await commandUtils.reply(ctx.message, `Command \`!${commandName}\` is already whitelisted.`);
            return;
        }

        const newWhitelist = [...config.commandWhitelist, commandName];
        deps.state.updateConfig(ctx.id, ctx.isDM, { commandWhitelist: newWhitelist });

        await commandUtils.reply(
            ctx.message,
            `Command \`!${commandName}\` has been added to the whitelist. Non-admins can now use it.`
        );
    }
};

/**
 * !unwhitelist <command> - Remove a command from the whitelist
 */
export const unwhitelistCommand: Command = {
    names: ['unwhitelist'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        if (!isAdmin(ctx.message)) {
            await commandUtils.reply(ctx.message, 'You must be a server administrator to use this command.');
            return;
        }

        const commandName = ctx.args[0]?.toLowerCase().replace(/^!/, '');

        if (!commandName) {
            await commandUtils.reply(ctx.message, 'Usage: `!unwhitelist <command>` - Remove a command from the non-admin whitelist.');
            return;
        }

        const config = deps.state.getConfig(ctx.id, ctx.isDM);

        // Check if it's in the whitelist
        const index = config.commandWhitelist.findIndex(c => c.toLowerCase() === commandName);
        if (index === -1) {
            await commandUtils.reply(ctx.message, `Command \`!${commandName}\` is not in the whitelist.`);
            return;
        }

        const newWhitelist = config.commandWhitelist.filter((_, i) => i !== index);
        deps.state.updateConfig(ctx.id, ctx.isDM, { commandWhitelist: newWhitelist });

        await commandUtils.reply(
            ctx.message,
            `Command \`!${commandName}\` has been removed from the whitelist.`
        );
    }
};

/**
 * !showwhitelist - Display current whitelisted commands
 */
export const showWhitelistCommand: Command = {
    names: ['showwhitelist'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const config = deps.state.getConfig(ctx.id, ctx.isDM);

        const adminStatus = config.adminMode ? '**ENABLED**' : '**DISABLED**';

        if (config.commandWhitelist.length === 0) {
            await commandUtils.reply(
                ctx.message,
                `Admin mode is ${adminStatus}.\nNo commands are whitelisted for non-admins.`
            );
        } else {
            const list = config.commandWhitelist.map(c => `\`!${c}\``).join(', ');
            await commandUtils.reply(
                ctx.message,
                `Admin mode is ${adminStatus}.\nWhitelisted commands: ${list}`
            );
        }
    }
};

// Export all admin commands
export const adminCommands: Command[] = [
    adminModeCommand,
    whitelistCommand,
    unwhitelistCommand,
    showWhitelistCommand
];
