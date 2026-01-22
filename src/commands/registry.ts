import { Command, CommandContext, CommandDependencies } from './types';
import { SYS_PREFIX } from './constants';
import { canExecuteCommand } from './utils';

/**
 * Command registry that maps command names to handlers
 */
export class CommandRegistry {
    private commands: Map<string, Command> = new Map();

    /**
     * Register a command handler
     */
    register(command: Command): void {
        for (const name of command.names) {
            this.commands.set(name.toLowerCase(), command);
        }
    }

    /**
     * Register multiple commands at once
     */
    registerAll(commands: Command[]): void {
        for (const command of commands) {
            this.register(command);
        }
    }

    /**
     * Get a command by name
     */
    get(name: string): Command | undefined {
        return this.commands.get(name.toLowerCase());
    }

    /**
     * Check if a command exists
     */
    has(name: string): boolean {
        return this.commands.has(name.toLowerCase());
    }

    /**
     * Execute a command by name
     */
    async execute(
        commandName: string,
        ctx: CommandContext,
        deps: CommandDependencies
    ): Promise<boolean> {
        const command = this.get(commandName);

        if (!command) {
            await ctx.message.reply(`${SYS_PREFIX}Unrecognized command "${commandName}".`);
            return false;
        }

        // Check if command requires guild
        if (command.requiresGuild && ctx.isDM) {
            await ctx.message.reply(`${SYS_PREFIX}This command is only available in servers, not in DMs.`);
            return false;
        }

        // Check admin mode permissions
        const config = deps.state.getConfig(ctx.id, ctx.isDM);
        const permCheck = canExecuteCommand(ctx.message, commandName, config);
        if (!permCheck.allowed) {
            await ctx.message.reply(`${SYS_PREFIX}${permCheck.reason}`);
            return false;
        }

        await command.execute(ctx, deps);
        return true;
    }

    /**
     * Get all registered command names
     */
    getCommandNames(): string[] {
        return Array.from(this.commands.keys());
    }
}

// Singleton registry instance
export const registry = new CommandRegistry();
