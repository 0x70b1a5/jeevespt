import { Collection } from 'discord.js';
import {
    AmbientTracker, decide, GateJudgment, medianWords, replyThreshold,
    ENGAGEMENT_DOWN, ENGAGEMENT_UP, FEEDBACK_WINDOW_MS, REACT_COST, REPLY_COST
} from './ambient';
import { ChannelHistory, toLlmMessages } from './history';
import { BASE_EMOJI, chooseReaction, customEmojiKey, judgeConversation, pickEmoji } from './gate';
import { createFollowupTool, createRememberTool, resolveParticipant } from '../llm/tools';

jest.mock('fs', () => ({
    promises: {
        readdir: jest.fn().mockResolvedValue([]),
        readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
        writeFile: jest.fn().mockResolvedValue(undefined),
        mkdir: jest.fn().mockResolvedValue(undefined)
    },
    readFileSync: jest.fn().mockReturnValue(''),
    existsSync: jest.fn().mockReturnValue(false)
}));
jest.mock('../getWebpage', () => ({ getWebpage: jest.fn() }));

// Imported after the fs mock so stores don't touch disk.
import { BotState } from '../state';

const BOT_ID = 'bot1';

function msg(id: string, text: string, opts: {
    author?: string; authorId?: string; bot?: boolean; webhookId?: string; replyTo?: string; ts?: number; interaction?: boolean;
} = {}) {
    const author = opts.author ?? 'tom';
    return {
        id,
        content: text,
        cleanContent: text,
        createdTimestamp: opts.ts ?? Number(id.replace(/\D/g, '')) * 1000,
        author: { id: opts.authorId ?? `${author}-id`, username: author, bot: !!opts.bot },
        member: null,
        webhookId: opts.webhookId ?? null,
        reference: opts.replyTo ? { messageId: opts.replyTo } : null,
        interactionMetadata: opts.interaction ? {} : null,
        attachments: new Collection(),
        embeds: [],
        url: `https://discord.com/channels/g/c/${id}`
    };
}

function channelOf(messages: any[], webhooks: { id: string; name: string }[] = []) {
    return {
        id: 'c1',
        client: { user: { id: BOT_ID } },
        messages: { fetch: jest.fn().mockResolvedValue(new Collection([...messages].reverse().map(m => [m.id, m]))) },
        fetchWebhooks: jest.fn().mockResolvedValue(new Collection(webhooks.map(w => [w.id, { ...w, owner: { id: BOT_ID } }])))
    };
}

function jevResponse(answers: Record<string, any>) {
    return { ok: true, status: 200, json: async () => ({ answers }), headers: new Headers(), text: async () => '' } as any;
}

describe('AmbientTracker', () => {
    let now: number;
    let tracker: AmbientTracker;
    beforeEach(() => {
        now = 1_000_000;
        tracker = new AmbientTracker(() => now);
    });

    it('earns a fair share of credit per human message, split among active speakers', () => {
        tracker.recordHuman('c', 'a', 1);
        expect(tracker.credit('c')).toBeCloseTo(1); // one speaker: every message
        tracker.recordHuman('c', 'b', 1);
        expect(tracker.credit('c')).toBeCloseTo(1.5); // capped
        tracker.spend('c', 1.5);
        tracker.recordHuman('c', 'a', 1);
        tracker.recordHuman('c', 'b', 1);
        expect(tracker.credit('c')).toBeCloseTo(1); // two speakers: half each
    });

    it('scales credit with sociability, and earns none at 0', () => {
        tracker.recordHuman('c', 'a', 0.5);
        expect(tracker.credit('c')).toBeCloseTo(0.5);
        tracker.recordHuman('d', 'a', 0);
        expect(tracker.credit('d')).toBe(0);
    });

    it('forgets speakers after the activity window', () => {
        tracker.recordHuman('c', 'a', 1);
        tracker.recordHuman('c', 'b', 1);
        expect(tracker.activeSpeakers('c')).toBe(2);
        now += 31 * 60_000;
        tracker.recordHuman('c', 'a', 1);
        expect(tracker.activeSpeakers('c')).toBe(1);
    });

    it('raises engagement when an unprompted message gets a response, lowers it when ignored', () => {
        tracker.recordUnprompted('c', 'j1');
        expect(tracker.isPending('c', 'j1')).toBe(true);
        expect(tracker.noteEngagement('c', 'j1')).toBe(true);
        expect(tracker.engagement('c')).toBeCloseTo(ENGAGEMENT_UP);
        expect(tracker.noteEngagement('c', 'j1')).toBe(false); // only counts once

        tracker.recordUnprompted('c', 'j2');
        now += FEEDBACK_WINDOW_MS;
        tracker.expire('c');
        expect(tracker.engagement('c')).toBeCloseTo(ENGAGEMENT_UP * ENGAGEMENT_DOWN);
        expect(tracker.isPending('c', 'j2')).toBe(false);
    });

    it('engagement multiplies earned credit', () => {
        tracker.recordUnprompted('c', 'j1');
        tracker.noteEngagement('c');
        tracker.recordHuman('c', 'a', 0.5);
        expect(tracker.credit('c')).toBeCloseTo(0.5 * ENGAGEMENT_UP);
    });
});

describe('decide', () => {
    const quiet: GateJudgment = {
        addressed: 0.05, value: 0.1, intrusive: 0.1, respondsToJeeves: 0, reactable: 0.2, targetId: 'm3', emoji: '👍'
    };

    it('answers when addressed, regardless of credit', () => {
        const d = decide({ ...quiet, addressed: 0.9 }, { credit: 0, sociability: 0, reactionsAllowed: true });
        expect(d).toMatchObject({ action: 'reply', direct: true });
    });

    it('chimes in when there is value and credit', () => {
        const d = decide({ ...quiet, value: 1 }, { credit: REPLY_COST, sociability: 0.3, reactionsAllowed: true });
        expect(d).toMatchObject({ action: 'reply', direct: false, targetId: 'm3' });
    });

    it('stays out without credit, or when joining would intrude', () => {
        expect(decide({ ...quiet, value: 1 }, { credit: 0.9, sociability: 1, reactionsAllowed: false }).action).toBe('none');
        expect(decide({ ...quiet, value: 1, intrusive: 0.8 }, { credit: 1.5, sociability: 1, reactionsAllowed: false }).action).toBe('none');
    });

    it('lowers the bar as sociability rises', () => {
        expect(replyThreshold(0)).toBeCloseTo(0.85);
        expect(replyThreshold(1)).toBeCloseTo(0.5);
        const middling = { ...quiet, value: 0.6, intrusive: 0 };
        expect(decide(middling, { credit: 1, sociability: 0.2, reactionsAllowed: false }).action).toBe('none');
        expect(decide(middling, { credit: 1, sociability: 1, reactionsAllowed: false }).action).toBe('reply');
    });

    it('reacts when a reply is not warranted but the message merits an emoji', () => {
        const d = decide({ ...quiet, reactable: 0.8 }, { credit: REACT_COST, sociability: 0.3, reactionsAllowed: true });
        expect(d).toEqual(expect.objectContaining({ action: 'react', emoji: '👍' }));
        expect(decide({ ...quiet, reactable: 0.8 }, { credit: 1, sociability: 0.3, reactionsAllowed: false }).action).toBe('none');
    });

    it('acknowledges a response to him ("thanks!") with a reaction more readily', () => {
        const thanks = { ...quiet, reactable: 0.37, emoji: '🙏' };
        expect(decide(thanks, { credit: 1, sociability: 0.3, reactionsAllowed: true }).action).toBe('none');
        expect(decide({ ...thanks, respondsToJeeves: 0.97 }, { credit: 1, sociability: 0.3, reactionsAllowed: true }))
            .toEqual(expect.objectContaining({ action: 'react', emoji: '🙏' }));
    });
});

describe('medianWords', () => {
    it('finds the typical message length', () => {
        expect(medianWords(['one', 'one two three', 'a b c d e f g'])).toBe(3);
        expect(medianWords([])).toBe(15);
    });
});

describe('ChannelHistory', () => {
    it('reads a channel oldest-first, marking our lines and skipping non-conversation', async () => {
        const history = new ChannelHistory();
        const channel = channelOf([
            msg('m1', 'who said the unexamined life is not worth living?'),
            msg('m2', '!help'),
            msg('m3', 'Socrates, sir.', { authorId: BOT_ID, author: 'Jeeves', bot: true }),
            msg('m4', '[SYSTEM] Prompt set.', { authorId: BOT_ID, author: 'Jeeves', bot: true }),
            msg('m5', 'panel', { authorId: BOT_ID, author: 'Jeeves', bot: true, interaction: true }),
            msg('m6', 'thanks!', { author: 'sarah', replyTo: 'm3' })
        ]);
        const lines = await history.fetch(channel, { limit: 20 });
        expect(lines.map(l => l.id)).toEqual(['m1', 'm3', 'm6']);
        expect(lines[1].isSelf).toBe(true);
        expect(lines[2].formatted).toContain('(replying to you: "Socrates, sir.")');

        const llm = toLlmMessages(lines);
        expect(llm.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
        expect(llm[0].content).toMatch(/\[tom\]: who said/);
        expect(llm[1].content).toBe('Socrates, sir.');
    });

    it('recognises our persona webhooks after a restart', async () => {
        const history = new ChannelHistory();
        const channel = channelOf(
            [msg('m1', 'hello'), msg('m2', 'Good day.', { author: 'Jeeves', bot: true, webhookId: 'wh1' })],
            [{ id: 'wh1', name: 'JeevesBot_jeeves' }]
        );
        const lines = await history.fetch(channel, { limit: 20 });
        expect(lines[1].isSelf).toBe(true);
        expect(history.isSelfId('wh1', BOT_ID)).toBe(true);
    });

    it('ignores messages before the context floor, and applies annotations', async () => {
        const history = new ChannelHistory();
        history.annotate('m3', { text: '(voice message) hello there', replaces: true });
        history.annotate('m4', { text: '[SYSTEM] file contents', replaces: false });
        history.hide('m5');
        const channel = channelOf([
            msg('m1', 'old'), msg('m3', ''), msg('m4', 'see attached'),
            msg('m5', 'transcript copy', { authorId: BOT_ID, author: 'Jeeves', bot: true })
        ]);
        const lines = await history.fetch(channel, { limit: 20, since: 2000 });
        expect(lines.map(l => l.text)).toEqual(['(voice message) hello there', 'see attached\n[SYSTEM] file contents']);
    });
});

describe('Jev gate', () => {
    let fetchSpy: jest.SpyInstance;
    beforeEach(() => {
        process.env.TYPESAFE_API_KEY = 'test-key';
        fetchSpy = jest.spyOn(global, 'fetch');
    });
    afterEach(() => fetchSpy.mockRestore());

    const lines = [
        { id: 'a', authorId: 't', authorName: 'tom', isSelf: false, isBot: false, text: 'who said it?', timestamp: 1, url: 'u', formatted: '' },
        { id: 'b', authorId: 's', authorName: 'sarah/Sarah', isSelf: false, isBot: false, text: 'aristotle?', timestamp: 2, url: 'u', formatted: '' }
    ];

    it('asks everything in one request and reduces the answers', async () => {
        fetchSpy.mockResolvedValueOnce(jevResponse({
            addressed: { type: 'noul', noul: 0.1 },
            value: { type: 'score', score: 2.7, probabilities: {}, confidence: 0.9 },
            intrusive: { type: 'noul', noul: 0.05 },
            responds: { type: 'noul', noul: 0.9 },
            reactable: { type: 'noul', noul: 0.3 },
            emoji: { type: 'choice', choice: '🤔', probabilities: { '🤔': 0.6, '🧐': 0.4 }, confidence: 0.5 },
            target: { type: 'choice', choice: 'm1', probabilities: { m1: 0.7, m2: 0.3 }, confidence: 0.5 }
        }));

        const judgment = await judgeConversation(lines, {
            mode: 'jeeves', channelName: 'general', customEmoji: [{ id: '42', name: 'pog' }], recentEmoji: ['🤔']
        });

        const request = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(request.model).toBe('jev-latest');
        expect(request.state.messages).toEqual([
            { id: 'm1', author: 'tom', text: 'who said it?' },
            { id: 'm2', author: 'Sarah', text: 'aristotle?' }
        ]);
        expect(request.questions.emoji.criteria['<:pog:42>']).toContain('pog');
        expect(Object.keys(request.questions.target.criteria)).toEqual(['m1', 'm2']);
        expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer test-key');

        expect(judgment).toEqual({
            addressed: 0.1,
            value: 0.9,
            intrusive: 0.05,
            respondsToJeeves: 0, // we haven't spoken in these messages
            reactable: 0.3,
            targetId: 'a',
            emoji: '🧐' // 🤔 was used recently: 0.6 × 0.3 < 0.4
        });
    });

    it('retries when overloaded', async () => {
        fetchSpy
            .mockResolvedValueOnce({ ok: false, status: 529, headers: new Headers({ 'retry-after': '0.001' }), text: async () => '' } as any)
            .mockResolvedValueOnce(jevResponse({ emoji: { type: 'choice', choice: '😂', probabilities: { '😂': 1 }, confidence: 1 } }));
        await expect(chooseReaction(lines, { mode: 'jeeves', customEmoji: [], recentEmoji: [] })).resolves.toBe('😂');
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('pickEmoji and custom emoji keys', () => {
        expect(pickEmoji({ '👍': 0.5, '😂': 0.4 }, [])).toBe('👍');
        expect(pickEmoji({ '👍': 0.5, '😂': 0.4 }, ['👍'])).toBe('😂');
        expect(customEmojiKey({ id: '1', name: 'dance', animated: true })).toBe('<a:dance:1>');
        expect(Object.keys(BASE_EMOJI).length).toBeGreaterThan(10);
    });
});

describe('people tools', () => {
    const people = [{ id: 'u1', name: 'tom' }, { id: 'u2', name: 'sarah/Sarah Smith' }];
    const scope = { id: 'g', isDM: false };

    it('resolves the names the model uses', () => {
        expect(resolveParticipant(people, '@Tom')?.id).toBe('u1');
        expect(resolveParticipant(people, 'sarah smith')?.id).toBe('u2');
        expect(resolveParticipant(people, 'sarah/Sarah Smith')?.id).toBe('u2');
        expect(resolveParticipant(people, 'bob')).toBeUndefined();
    });

    it('remember_about_person stores a note about someone in the chat', async () => {
        const state = new BotState();
        const tool = createRememberTool(state, scope, people);
        await expect(tool.run({ person: 'tom', fact: 'Has a viva on Friday.' })).resolves.toContain('tom');
        expect(state.getPersonNotes('g', false, 'u1').map(n => n.text)).toEqual(['Has a viva on Friday.']);
        await expect(tool.run({ person: 'bob', fact: 'x' })).rejects.toThrow(/People here: tom, sarah/);
    });

    it('schedule_followup plans a follow-up reminder for that person', async () => {
        const state = new BotState();
        const tool = createFollowupTool(state, scope, 'c1', people);
        await tool.run({ person: 'sarah', about: 'her viva', hours_from_now: 48 });
        const [reminder] = state.getRemindersForUser('u2');
        expect(reminder).toMatchObject({ channelId: 'c1', isDM: false, followup: { about: 'her viva' } });
        expect(reminder.triggerTime.getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000);
        await expect(tool.run({ person: 'sarah', about: 'x', hours_from_now: -1 })).rejects.toThrow(/hours_from_now/);
    });
});
