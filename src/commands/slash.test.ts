import { ApplicationCommandOptionType } from 'discord.js';
import { buildSlashCommandData, interactionToArgs, createInteractionMessage } from './slash';
import { Command } from './types';

const noop = async () => {};

describe('buildSlashCommandData', () => {
    it('excludes slashExclude commands', () => {
        const cmds: Command[] = [
            { names: ['keep'], description: 'k', execute: noop },
            { names: ['drop'], description: 'd', slashExclude: true, execute: noop }
        ];
        const data = buildSlashCommandData(cmds);
        expect(data.map(d => d.name)).toEqual(['keep']);
    });

    it('falls back to a non-empty description (Discord requires 1–100 chars)', () => {
        const data = buildSlashCommandData([{ names: ['x'], execute: noop }]);
        expect(data[0].description.length).toBeGreaterThan(0);
        expect(data[0].description.length).toBeLessThanOrEqual(100);
    });

    it('sorts required options before optional ones', () => {
        const cmd: Command = {
            names: ['c'], description: 'c', execute: noop,
            options: [
                { name: 'opt', description: 'o', type: 'string', required: false },
                { name: 'req', description: 'r', type: 'string', required: true }
            ]
        };
        const [data] = buildSlashCommandData([cmd]);
        expect(data.options.map((o: any) => o.name)).toEqual(['req', 'opt']);
        expect(data.options[0].required).toBe(true);
        expect(data.options[1].required).toBe(false);
    });

    it('maps option types and carries string choices', () => {
        const cmd: Command = {
            names: ['c'], description: 'c', execute: noop,
            options: [
                { name: 'ch', description: 'c', type: 'channel', required: true },
                { name: 'n', description: 'n', type: 'integer', required: false },
                {
                    name: 'freq', description: 'f', type: 'string', required: false,
                    choices: [{ name: 'All', value: 'all' }, { name: 'None', value: 'none' }]
                }
            ]
        };
        const [data] = buildSlashCommandData([cmd]);
        const byName = Object.fromEntries(data.options.map((o: any) => [o.name, o]));
        expect(byName.ch.type).toBe(ApplicationCommandOptionType.Channel);
        expect(byName.n.type).toBe(ApplicationCommandOptionType.Integer);
        expect(byName.freq.choices).toEqual([
            { name: 'All', value: 'all' },
            { name: 'None', value: 'none' }
        ]);
    });
});

function fakeInteraction(values: Record<string, any>) {
    const get = (n: string) => (n in values ? values[n] : null);
    return {
        options: {
            getString: get,
            getInteger: get,
            getNumber: get,
            getBoolean: get,
            getChannel: get,
            getUser: get
        }
    } as any;
}

describe('interactionToArgs', () => {
    it('splits a rest string option into whitespace-separated tokens', () => {
        const cmd: Command = {
            names: ['remind'], execute: noop,
            options: [
                { name: 'time', description: 't', type: 'string', required: true },
                { name: 'message', description: 'm', type: 'string', required: true, rest: true }
            ]
        };
        const args = interactionToArgs(cmd, fakeInteraction({ time: '5m', message: 'Take a break' }));
        // Reconstructs the legacy parse: args[0] = time, args.slice(1).join(' ') = message.
        expect(args[0]).toBe('5m');
        expect(args.slice(1).join(' ')).toBe('Take a break');
    });

    it('renders channel and user options as mentions', () => {
        const cmd: Command = {
            names: ['translateadduser'], execute: noop,
            options: [
                { name: 'user', description: 'u', type: 'user', required: true },
                { name: 'language', description: 'l', type: 'string', required: true, rest: true }
            ]
        };
        const args = interactionToArgs(cmd, fakeInteraction({ user: { id: '42' }, language: 'toki pona' }));
        expect(args[0]).toBe('<@42>');
        expect(args.slice(1).join(' ')).toBe('toki pona');
    });

    it('stringifies integer/number/boolean options', () => {
        const cmd: Command = {
            names: ['x'], execute: noop,
            options: [
                { name: 'i', description: 'i', type: 'integer', required: true },
                { name: 'n', description: 'n', type: 'number', required: true },
                { name: 'b', description: 'b', type: 'boolean', required: true }
            ]
        };
        const args = interactionToArgs(cmd, fakeInteraction({ i: 7, n: 1.5, b: true }));
        expect(args).toEqual(['7', '1.5', 'true']);
    });

    it('skips omitted optional options', () => {
        const cmd: Command = {
            names: ['config'], execute: noop,
            options: [
                { name: 'channel', description: 'c', type: 'channel', required: false },
                { name: 'frequency', description: 'f', type: 'string', required: false }
            ]
        };
        const args = interactionToArgs(cmd, fakeInteraction({ channel: { id: '99' } }));
        expect(args).toEqual(['<#99>']);
    });
});

function fakeReplyInteraction(deferred: boolean) {
    return {
        deferred,
        reply: jest.fn().mockResolvedValue(undefined),
        followUp: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        user: { id: 'u' },
        member: null,
        guild: null,
        channel: null
    } as any;
}

describe('createInteractionMessage ephemeral handling', () => {
    it('marks the first (non-deferred) reply ephemeral', async () => {
        const interaction = fakeReplyInteraction(false);
        const tracker = { consumed: false };
        const message = createInteractionMessage(interaction, tracker, '!x', true);
        await message.reply('done');
        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'done', ephemeral: true })
        );
        expect(tracker.consumed).toBe(true);
    });

    it('does not pass ephemeral to editReply after a defer (visibility is locked at defer time)', async () => {
        const interaction = fakeReplyInteraction(true);
        const tracker = { consumed: false };
        const message = createInteractionMessage(interaction, tracker, '!x', true);
        await message.reply('done');
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.not.objectContaining({ ephemeral: expect.anything() })
        );
    });

    it('marks follow-up replies ephemeral too', async () => {
        const interaction = fakeReplyInteraction(false);
        const tracker = { consumed: false };
        const message = createInteractionMessage(interaction, tracker, '!x', true);
        await message.reply('first');
        await message.reply('second');
        expect(interaction.followUp).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'second', ephemeral: true })
        );
    });

    it('keeps replies public when the command is not ephemeral', async () => {
        const interaction = fakeReplyInteraction(false);
        const tracker = { consumed: false };
        const message = createInteractionMessage(interaction, tracker, '!x', false);
        await message.reply('hi');
        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({ ephemeral: false })
        );
    });
});
