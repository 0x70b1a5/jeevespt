import { buildHelpEmbed, buildCommandDetailEmbed, deriveUsage } from './commands/helpText';
import { Command } from './commands/types';

const noop = async () => {};

const sampleCommands: Command[] = [
    { names: ['jeeves'], description: 'Act like Jeeves.', category: 'Modes', execute: noop },
    {
        names: ['remind'], description: 'Set a reminder.', category: 'Reminders',
        options: [
            { name: 'time', description: 'Delay', type: 'string', required: true },
            { name: 'message', description: 'What to remind you about', type: 'string', required: true, rest: true }
        ],
        examples: ['!remind 5m Take a break'], execute: noop
    },
    // Alias deliberately NOT a substring of the primary name, so substring
    // assertions below are meaningful.
    { names: ['websearch', 'ws'], description: 'Enable web search.', category: 'Configuration', execute: noop },
    { names: ['patreon'], description: 'Operator only.', category: 'Patreon', hidden: true, execute: noop }
];

describe('deriveUsage', () => {
    it('returns just the name when there are no options', () => {
        expect(deriveUsage(sampleCommands[0])).toBe('!jeeves');
    });

    it('marks required and rest options', () => {
        expect(deriveUsage(sampleCommands[1])).toBe('!remind <time> <message...>');
    });

    it('honors an explicit usage override', () => {
        const cmd: Command = { names: ['x'], usage: 'FOO BAR', execute: noop };
        expect(deriveUsage(cmd)).toBe('!x FOO BAR');
    });

    it('wraps optional options in brackets', () => {
        const cmd: Command = {
            names: ['model'], execute: noop,
            options: [{ name: 'model', description: 'id', type: 'string', required: false }]
        };
        expect(deriveUsage(cmd)).toBe('!model [model]');
    });
});

describe('buildHelpEmbed', () => {
    const embed = buildHelpEmbed(sampleCommands, ['some status line']);

    it('produces a single embed with a title, status, and fields', () => {
        expect(embed.title).toContain('JeevesPT');
        expect(embed.description).toContain('some status line');
        expect(Array.isArray(embed.fields)).toBe(true);
        expect(embed.fields!.length).toBeGreaterThan(0);
    });

    it('omits hidden commands', () => {
        const serialized = JSON.stringify(embed);
        expect(serialized).toContain('jeeves');
        expect(serialized).not.toContain('patreon');
    });

    it('orders known categories (Modes before Configuration)', () => {
        const names = embed.fields!.map(f => f.name);
        expect(names.indexOf('Modes')).toBeLessThan(names.indexOf('Configuration'));
    });

    it('lists only the primary name, not aliases', () => {
        const config = embed.fields!.find(f => f.name === 'Configuration')!;
        expect(config.value).toContain('websearch');
        expect(config.value).not.toContain('`ws`');
    });

    it('keeps every field value within the Discord 1024-char limit, splitting big categories', () => {
        const many: Command[] = Array.from({ length: 40 }, (_, i) => ({
            names: [`configcmd${i}`], description: 'x'.repeat(40), category: 'Configuration', execute: noop
        }));
        const big = buildHelpEmbed(many, []);
        for (const field of big.fields!) {
            expect(field.value.length).toBeLessThanOrEqual(1024);
        }
        expect(big.fields!.some(f => f.name.includes('cont.'))).toBe(true);
    });
});

describe('buildCommandDetailEmbed', () => {
    it('titles with the command name and includes usage', () => {
        const embed = buildCommandDetailEmbed(sampleCommands[1]);
        expect(embed.title).toBe('!remind');
        expect(embed.description).toContain('!remind <time> <message...>');
    });

    it('includes Arguments and Examples fields', () => {
        const embed = buildCommandDetailEmbed(sampleCommands[1]);
        const fieldNames = embed.fields!.map(f => f.name);
        expect(fieldNames).toContain('Arguments');
        expect(fieldNames).toContain('Examples');
    });

    it('shows aliases when present', () => {
        const embed = buildCommandDetailEmbed(sampleCommands[2]);
        expect(embed.description).toContain('`!ws`');
    });
});
