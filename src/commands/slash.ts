import {
    ApplicationCommandOptionType,
    ChatInputCommandInteraction,
    Client,
    Collection,
    Message
} from 'discord.js';
import { Command, CommandOptionType } from './types';

/**
 * Slash-command bridge.
 *
 * Discord slash commands and the generated `!help` are both built from the SAME
 * command metadata (description / options), so they can never drift. This module:
 *   1. builds slash-command registration payloads from the registry (buildSlashCommandData)
 *   2. registers them with Discord (registerSlashCommands)
 *   3. reconstructs the legacy `string[]` args from an interaction (interactionToArgs)
 *   4. wraps an interaction in a Message-shaped adapter so existing command
 *      handlers run unchanged (createInteractionMessage)
 *
 * The legacy `!`-prefix text path is left fully intact and still funnels through
 * the same registry, so voice commands ("command clear" → `!clear`) keep working.
 */

const OPTION_TYPE: Record<CommandOptionType, ApplicationCommandOptionType> = {
    string: ApplicationCommandOptionType.String,
    integer: ApplicationCommandOptionType.Integer,
    number: ApplicationCommandOptionType.Number,
    boolean: ApplicationCommandOptionType.Boolean,
    channel: ApplicationCommandOptionType.Channel,
    user: ApplicationCommandOptionType.User
};

/**
 * Convert the registry's commands into Discord slash-command registration data.
 * Commands flagged `slashExclude` (operator-only, voice-only) are skipped.
 */
export function buildSlashCommandData(commands: Command[]): any[] {
    const data: any[] = [];

    for (const cmd of commands) {
        if (cmd.slashExclude) continue;

        // Discord requires required options to precede optional ones.
        const options = (cmd.options ?? [])
            .slice()
            .sort((a, b) => Number(!!b.required) - Number(!!a.required))
            .map(opt => {
                const entry: any = {
                    name: opt.name,
                    description: opt.description.slice(0, 100),
                    type: OPTION_TYPE[opt.type],
                    required: !!opt.required
                };
                if (opt.choices && (opt.type === 'string' || opt.type === 'integer' || opt.type === 'number')) {
                    entry.choices = opt.choices.map(c => ({
                        name: c.name.slice(0, 100),
                        value: opt.type === 'string' ? c.value : Number(c.value)
                    }));
                }
                return entry;
            });

        data.push({
            name: cmd.names[0],
            description: (cmd.description || 'No description.').slice(0, 100),
            options
        });
    }

    return data;
}

/**
 * Register the slash commands with Discord.
 *
 * If DISCORD_GUILD_ID is set, registers to that guild (instant — best for a
 * single-server bot or dev). Otherwise registers globally (works in DMs and
 * every guild; first propagation can take up to an hour).
 */
export async function registerSlashCommands(client: Client, commands: Command[]): Promise<void> {
    const data = buildSlashCommandData(commands);
    const guildId = process.env.DISCORD_GUILD_ID;

    try {
        if (guildId) {
            const guild = await client.guilds.fetch(guildId);
            await guild.commands.set(data);
            console.log(`✅ Registered ${data.length} slash commands to guild ${guildId}`);
        } else {
            await client.application!.commands.set(data);
            console.log(`✅ Registered ${data.length} global slash commands`);
        }
    } catch (error) {
        console.error('❌ Failed to register slash commands:', error);
    }
}

/**
 * Rebuild the legacy `args: string[]` that text-path handlers expect from a
 * slash interaction's typed options. Mirrors `content.slice(1).split(' ')`:
 *   - `rest` string options are split on whitespace into multiple tokens, so
 *     `args.slice(n).join(' ')` reconstructs the original phrase.
 *   - channel/user options become `<#id>` / `<@id>` so the existing
 *     mention-parsing helpers work untouched.
 */
export function interactionToArgs(cmd: Command, interaction: ChatInputCommandInteraction): string[] {
    const args: string[] = [];

    for (const opt of cmd.options ?? []) {
        let token: string | null = null;

        switch (opt.type) {
            case 'string':
                token = interaction.options.getString(opt.name);
                break;
            case 'integer': {
                const v = interaction.options.getInteger(opt.name);
                token = v === null ? null : String(v);
                break;
            }
            case 'number': {
                const v = interaction.options.getNumber(opt.name);
                token = v === null ? null : String(v);
                break;
            }
            case 'boolean': {
                const v = interaction.options.getBoolean(opt.name);
                token = v === null ? null : String(v);
                break;
            }
            case 'channel': {
                const v = interaction.options.getChannel(opt.name);
                token = v ? `<#${v.id}>` : null;
                break;
            }
            case 'user': {
                const v = interaction.options.getUser(opt.name);
                token = v ? `<@${v.id}>` : null;
                break;
            }
        }

        if (token === null || token === undefined) continue;

        if (opt.rest && opt.type === 'string') {
            for (const word of token.split(/\s+/).filter(Boolean)) args.push(word);
        } else {
            args.push(token);
        }
    }

    return args;
}

/** Tracks whether the interaction's deferred/initial reply has been consumed. */
export interface ReplyTracker {
    consumed: boolean;
}

/**
 * Wrap a slash interaction in an object that satisfies the small slice of the
 * discord.js `Message` API that command handlers actually use (`author`,
 * `member`, `guild`, `channel`, `attachments`, and `reply`). This lets every
 * existing handler run against a slash interaction with zero changes.
 *
 * The `reply` shim is the important bit: the first reply consumes the
 * interaction's (possibly deferred) response, and every subsequent reply
 * becomes a `followUp`, so multi-reply commands behave correctly.
 */
export function createInteractionMessage(
    interaction: ChatInputCommandInteraction,
    tracker: ReplyTracker,
    reconstructedContent: string,
    ephemeral = false
): Message {
    const reply = async (payload: any): Promise<any> => {
        const data = typeof payload === 'string' ? { content: payload } : { ...payload };
        if (!tracker.consumed) {
            tracker.consumed = true;
            // After a deferReply the visibility is already locked in, so
            // editReply must not carry an `ephemeral` field.
            if (interaction.deferred) return interaction.editReply(data);
            return interaction.reply({ ...data, ephemeral: data.ephemeral ?? ephemeral });
        }
        return interaction.followUp({ ...data, ephemeral: data.ephemeral ?? ephemeral });
    };

    const adapter = {
        author: interaction.user,
        member: interaction.member,
        guild: interaction.guild,
        channel: interaction.channel,
        attachments: new Collection(),
        content: reconstructedContent,
        reply
    };

    return adapter as unknown as Message;
}
