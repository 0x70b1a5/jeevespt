/**
 * `/settings` — the one command for every setting in the settings table
 * (settings/schema.ts) plus persona and model. The old per-setting commands
 * (`!thinkon`, `!tokens 500`, …) are retired; see commands/retired.ts.
 */

import { Command, CommandContext, CommandDependencies } from './types';
import { buildSettingsPanel } from '../settings/panel';

export const settingsCommand: Command = {
    names: ['settings'],
    description: 'Open the settings panel: toggle buttons, persona and model menus, and a form for numbers.',
    category: 'Configuration',
    deferred: true, // the model menu may fetch live model lists
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        await ctx.message.reply(await buildSettingsPanel(deps.state, ctx.id, ctx.isDM));
    }
};

export const settingsCommands: Command[] = [settingsCommand];
