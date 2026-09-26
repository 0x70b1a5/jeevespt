/**
 * `/settings` panel command, plus the classic `!thinkon`, `!tokens 500`, …
 * commands — generated from the settings table (settings/schema.ts) rather
 * than hand-written, so a new setting needs one table entry, not four places.
 */

import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils } from './utils';
import {
    SETTINGS, NumberSetting, ToggleSetting, applySetting, describeRange, formatSetting, parseSettingValue
} from '../settings/schema';
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

function toggleCommands(setting: ToggleSetting): Command[] {
    const commands: Command[] = [];
    const make = (names: string[], description: string, next: (current: boolean) => boolean): Command => ({
        names,
        description,
        category: setting.category,
        requiresGuild: setting.guildOnly,
        ephemeral: true,
        async execute(ctx: CommandContext, deps: CommandDependencies) {
            const config = deps.state.getConfig(ctx.id, ctx.isDM);
            applySetting(deps.state, ctx.id, ctx.isDM, setting, next(config[setting.key]));
            await commandUtils.reply(
                ctx.message,
                `${setting.emoji} ${setting.label}: **${formatSetting(setting, deps.state.getConfig(ctx.id, ctx.isDM)).toUpperCase()}**`
            );
        }
    });
    const { on, off, toggle } = setting.commands ?? {};
    if (on?.length) commands.push(make(on, `Turn ${setting.label.toLowerCase()} on: ${setting.description}`, () => true));
    if (off?.length) commands.push(make(off, `Turn ${setting.label.toLowerCase()} off.`, () => false));
    if (toggle?.length) commands.push(make(toggle, `Toggle ${setting.label.toLowerCase()}: ${setting.description}`, current => !current));
    return commands;
}

function numberCommand(setting: NumberSetting): Command[] {
    if (!setting.command) return [];
    const { names, option } = setting.command;
    return [{
        names,
        description: `Set ${setting.label.toLowerCase()}: ${setting.description}`,
        category: setting.category,
        requiresGuild: setting.guildOnly,
        ephemeral: true,
        options: [{ name: option.name, description: option.description, type: setting.integer ? 'integer' : 'number', required: true }],
        async execute(ctx: CommandContext, deps: CommandDependencies) {
            const parsed = parseSettingValue(setting, ctx.args[0] ?? '');
            if (!parsed.ok) {
                await commandUtils.reply(
                    ctx.message,
                    `Couldn't parse \`${ctx.args[0] ?? ''}\`. ${setting.label} must be ${describeRange(setting)}.`
                );
                return;
            }
            applySetting(deps.state, ctx.id, ctx.isDM, setting, parsed.value);
            await commandUtils.reply(
                ctx.message,
                `${setting.emoji} ${setting.label} set to ${formatSetting(setting, deps.state.getConfig(ctx.id, ctx.isDM))}.`
            );
        }
    }];
}

export const settingsCommands: Command[] = [
    settingsCommand,
    ...SETTINGS.flatMap(s => s.kind === 'toggle' ? toggleCommands(s) : numberCommand(s))
];
