import { APIEmbed } from 'discord.js';
import { Command } from './types';

/**
 * Help text is GENERATED from command metadata (description / category /
 * options / examples) so it can never drift from the actual commands the way a
 * hand-maintained help string does. The same metadata also drives Discord
 * slash-command registration (see ./slash.ts).
 */

const EMBED_COLOR = 0xd4a27f; // Anthropic clay, matching the README badge.
const FIELD_VALUE_LIMIT = 1024; // Discord embed field-value hard limit.

/** Preferred category order in the listing; unknown categories are appended. */
const CATEGORY_ORDER = [
    'Modes',
    'Chat History',
    'Configuration',
    'Musing',
    'Reactions',
    'Reminders',
    'Tasks',
    'Learning',
    'Autotranslate',
    'Sitelen Sitelen',
    'Transcription',
    'Admin',
    'General'
];

/**
 * Build a `!name <required> [optional]` usage string. Uses an explicit
 * `usage` override if present, otherwise derives it from the option schema.
 */
export function deriveUsage(cmd: Command): string {
    const head = `!${cmd.names[0]}`;
    if (cmd.usage) return `${head} ${cmd.usage}`.trim();
    if (!cmd.options || cmd.options.length === 0) return head;

    const parts = cmd.options.map(opt => {
        const inner = opt.rest ? `${opt.name}...` : opt.name;
        return opt.required ? `<${inner}>` : `[${inner}]`;
    });
    return `${head} ${parts.join(' ')}`;
}

/** Pack lines into newline-joined chunks that each stay under `max` chars. */
function chunkLines(lines: string[], max: number): string[] {
    const chunks: string[] = [];
    let current = '';
    for (const line of lines) {
        if (current && current.length + 1 + line.length > max) {
            chunks.push(current);
            current = line;
        } else {
            current = current ? `${current}\n${line}` : line;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

/**
 * Build the compact, categorized command listing as a single embed.
 * Replaces the old 13-message help dump.
 */
export function buildHelpEmbed(commands: Command[], statusLines: string[]): APIEmbed {
    const visible = commands.filter(c => !c.hidden);

    const byCategory = new Map<string, Command[]>();
    for (const cmd of visible) {
        const category = cmd.category || 'Other';
        if (!byCategory.has(category)) byCategory.set(category, []);
        byCategory.get(category)!.push(cmd);
    }

    const orderedCategories = [
        ...CATEGORY_ORDER.filter(c => byCategory.has(c)),
        ...[...byCategory.keys()].filter(c => !CATEGORY_ORDER.includes(c))
    ];

    const fields: NonNullable<APIEmbed['fields']> = [];
    for (const category of orderedCategories) {
        const lines = byCategory.get(category)!.map(
            cmd => `\`${cmd.names[0]}\`${cmd.description ? ` — ${cmd.description}` : ''}`
        );
        // A single category can exceed the 1024-char field limit (e.g.
        // Configuration), so split it across "(cont.)" fields when needed.
        chunkLines(lines, FIELD_VALUE_LIMIT).forEach((value, i) => {
            fields.push({ name: i === 0 ? category : `${category} (cont.)`, value });
        });
    }

    return {
        title: '🎩 JeevesPT — Commands',
        description:
            statusLines.join('\n') +
            '\n\nUse `!help <command>` (or `/help command:<name>`) for details on a single command.',
        color: EMBED_COLOR,
        fields
    };
}

/** Build the detailed help embed for a single command. */
export function buildCommandDetailEmbed(cmd: Command): APIEmbed {
    const fields: NonNullable<APIEmbed['fields']> = [];

    if (cmd.options && cmd.options.length > 0) {
        fields.push({
            name: 'Arguments',
            value: cmd.options
                .map(opt => {
                    const flag = opt.required ? '' : ' _(optional)_';
                    const choices = opt.choices ? ` — one of: ${opt.choices.map(c => `\`${c.value}\``).join(', ')}` : '';
                    return `\`${opt.name}\`${flag} — ${opt.description}${choices}`;
                })
                .join('\n')
        });
    }

    if (cmd.examples && cmd.examples.length > 0) {
        fields.push({ name: 'Examples', value: cmd.examples.map(e => `\`${e}\``).join('\n') });
    }

    const aliases = cmd.names.slice(1);
    const notes: string[] = [];
    notes.push(`**Usage:** \`${deriveUsage(cmd)}\``);
    if (aliases.length > 0) notes.push(`**Aliases:** ${aliases.map(a => `\`!${a}\``).join(', ')}`);
    if (cmd.requiresGuild) notes.push('_Server-only (not available in DMs)._');

    return {
        title: `!${cmd.names[0]}`,
        description: `${cmd.description || ''}\n\n${notes.join('\n')}`.trim(),
        color: EMBED_COLOR,
        fields
    };
}
