/**
 * Managed lists: a message listing entries (reminders, tasks, translate
 * targets, learning subjects, reaction channels, whitelisted commands) with a
 * ❌ button per entry. Replaces the old list/remove/cancel command pairs.
 *
 * Like the settings panel, buttons are stateless: the custom_id carries
 *   lst:<kind>:<owner>:<index>:<fingerprint>
 * where owner is the user a per-user list belongs to ('-' otherwise) and the
 * fingerprint is a short hash of the entry — so if the list changed since it
 * was drawn, a click refreshes it instead of removing the wrong entry.
 */

import {
    ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, Interaction
} from 'discord.js';
import { CommandDependencies } from './types';
import { interactionPermissionError } from './utils';

export interface ListScope {
    id: string;
    isDM: boolean;
    /** The user whose list this is (per-user lists only). */
    ownerId: string;
}

export interface ListEntry {
    /** Stable identity, fingerprinted into the button. */
    value: string;
    /** How the entry reads in the list. */
    text: string;
}

export interface ListKind {
    /** Short code used in custom_ids. */
    code: string;
    /** The command that shows this list (for whitelisting + hints). */
    command: string;
    title: string;
    /** Entries belong to one user; only that user may remove them. */
    perUser?: boolean;
    /** Removing needs a server administrator. */
    requiresAdmin?: boolean;
    /** Shown when there are no entries. */
    empty: string;
    /** Optional status lines above the entries. */
    header?(deps: CommandDependencies, scope: ListScope): string;
    entries(deps: CommandDependencies, scope: ListScope): ListEntry[];
    remove(deps: CommandDependencies, scope: ListScope, entry: ListEntry): void;
}

const MAX_BUTTONS = 25; // 5 rows × 5 — Discord's limit per message
const LIST_COLOR = 0x4a5568;
const kinds = new Map<string, ListKind>();

export function registerListKind(kind: ListKind): ListKind {
    kinds.set(kind.code, kind);
    return kind;
}

export function buildListMessage(
    kind: ListKind,
    deps: CommandDependencies,
    scope: ListScope,
    /** A line above the list, e.g. "✅ Added …" — mentions render here, unlike in footers. */
    note?: string
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
    const entries = kind.entries(deps, scope);
    const parts: string[] = [];
    if (note) parts.push(note);
    const header = kind.header?.(deps, scope);
    if (header) parts.push(header);
    parts.push(entries.length
        ? entries.map((e, i) => `**${i + 1}.** ${e.text}`).join('\n')
        : `*${kind.empty}*`);
    if (entries.length > MAX_BUTTONS) {
        parts.push(`*Only the first ${MAX_BUTTONS} can be removed with buttons; remove some and run \`/${kind.command}\` again.*`);
    }

    const embed = new EmbedBuilder()
        .setColor(LIST_COLOR)
        .setTitle(kind.title)
        .setDescription(parts.join('\n\n').slice(0, 4096));
    if (entries.length) embed.setFooter({ text: 'Click ❌ to remove an entry' });

    const owner = kind.perUser ? scope.ownerId : '-';
    const buttons = entries.slice(0, MAX_BUTTONS).map((e, i) =>
        new ButtonBuilder()
            .setCustomId(`lst:${kind.code}:${owner}:${i}:${fingerprint(e.value)}`)
            .setLabel(String(i + 1))
            .setEmoji('❌')
            .setStyle(ButtonStyle.Secondary)
    );
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < buttons.length; i += 5) {
        components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
    }
    return { embeds: [embed], components };
}

export function isListInteraction(interaction: Interaction): interaction is ButtonInteraction {
    return interaction.isButton() && interaction.customId.startsWith('lst:');
}

export async function handleListInteraction(interaction: ButtonInteraction, deps: CommandDependencies): Promise<void> {
    const [, code, owner, indexStr, print] = interaction.customId.split(':');
    const kind = kinds.get(code);
    if (!kind) return;

    const isDM = !interaction.guildId;
    const scope: ListScope = {
        id: interaction.guildId ?? interaction.user.id,
        isDM,
        ownerId: kind.perUser ? owner : interaction.user.id
    };
    const refuse = (reason: string) => interaction.reply({ content: `🔒 ${reason}`, ephemeral: true });

    if (kind.perUser && interaction.user.id !== owner) {
        await refuse(`Only <@${owner}> can remove these.`);
        return;
    }
    const denied = interactionPermissionError(
        interaction, deps.state.getConfig(scope.id, isDM), { requiresAdmin: kind.requiresAdmin, command: kind.command }
    );
    if (denied) {
        await refuse(denied);
        return;
    }

    const entry = kind.entries(deps, scope)[Number(indexStr)];
    const who = interaction.user.displayName ?? interaction.user.username;
    if (!entry || fingerprint(entry.value) !== print) {
        await interaction.update(buildListMessage(kind, deps, scope, '🔄 *The list had changed since it was shown — here it is again.*'));
        return;
    }
    kind.remove(deps, scope, entry);
    console.log(`🗑️ ${who} removed ${kind.code} entry "${entry.value}" (${isDM ? 'DM' : 'guild'} ${scope.id})`);
    await interaction.update(buildListMessage(kind, deps, scope, `🗑️ Removed ${entry.text} — *${who}*`));
}

/** Short, stable hash (djb2, base36) — identity check, not security. */
export function fingerprint(value: string): string {
    let h = 5381;
    for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
