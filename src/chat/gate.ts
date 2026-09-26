/**
 * The Jev side of ambient participation: turn recent channel history into one
 * TypeSafe request of narrow questions, and reduce the answers to a
 * GateJudgment that ambient.ts's `decide` applies policy to.
 *
 * Jev reads literally and suffers from irrelevant context, so the state is
 * just the last few messages (trimmed) plus one line about who Jeeves is, and
 * every question points at `messages[i]` by path.
 */

import { ChatLine, snippet } from './history';
import { GateJudgment } from './ambient';
import { argmaxWeighted, ChoiceQuestion, systemOne } from '../llm/typesafe';
import { PERSONAS } from '../commands/constants';

const GATE_MESSAGES = 15;
const TARGET_CANDIDATES = 8;
const MESSAGE_CHARS = 400;
const MAX_CUSTOM_EMOJI = 40;
/** Recently used emoji are down-weighted by this factor, for variety. */
const RECENT_EMOJI_WEIGHT = 0.3;

/** Unicode reactions on offer, each with what it conveys. */
export const BASE_EMOJI: Record<string, string> = {
    '😂': 'genuinely funny',
    '😄': 'pleasant, light-hearted',
    '👍': 'agreement or acknowledgement',
    '👏': 'well done, applause',
    '🎉': 'celebration, good news',
    '❤️': 'warm, touching, affectionate',
    '🙏': 'thanks, gratitude, or a hope',
    '🤔': 'puzzling or thought-provoking',
    '🧐': 'a scholarly or pedantic point',
    '👀': 'intriguing, gossip, drama',
    '😮': 'surprising',
    '😬': 'awkward, yikes',
    '😢': 'sad news, sympathy',
    '🔥': 'impressive, excellent',
    '💯': 'exactly right',
    '🙃': 'ironic, gently absurd',
    '🤝': 'a deal, agreement between people',
    '☕': 'cosy, morning, tea and conversation',
    '🍷': 'relaxing, indulgent, evening',
    '📚': 'books, study, learning',
    '🎩': 'dapper, proper, very Jeeves',
    '⛪': 'religion, church, theology',
    '🐸': 'whimsical',
    '🫡': 'duty, will do, respect',
    '😴': 'boring or tired'
};

export interface CustomEmoji {
    id: string;
    name: string;
    animated?: boolean | null;
}

export function personaBlurb(mode: string): string {
    switch (mode) {
        case 'tokipona':
            return 'jan pona is a member of this Discord server who speaks only toki pona and is friendly and wise.';
        case 'lugso':
            return '5ub-sot is a member of this Discord server: a strange, poetic entity who speaks the Lugso language.';
        case 'customprompt':
            return 'The bot is a member of this Discord server with a custom personality.';
        default:
            return 'Jeeves is a member of this Discord server: a well-read, witty butler (Wodehouse\'s Jeeves) '
                + 'who knows philosophy, theology, literature, languages, history and trivia.';
    }
}

/** The Jev state: persona line + the last few messages with short ids. */
function buildState(lines: ChatLine[], mode: string, channelName?: string) {
    const recent = lines.slice(-GATE_MESSAGES);
    const shortIds = new Map(recent.map((line, i) => [line.id, `m${i + 1}`]));
    const persona = PERSONAS[mode]?.name ?? 'Jeeves';
    return {
        recent,
        shortIds,
        persona,
        state: {
            about: personaBlurb(mode),
            ...(channelName ? { channel: `#${channelName}` } : {}),
            messages: recent.map(line => ({
                id: shortIds.get(line.id)!,
                author: line.isSelf ? persona : line.authorName.split('/').pop(),
                ...(line.replyToId && shortIds.has(line.replyToId) ? { replying_to: shortIds.get(line.replyToId) } : {}),
                text: snippet(line.text, MESSAGE_CHARS)
            }))
        }
    };
}

export function emojiQuestion(latestPath: string, customEmoji: CustomEmoji[]): ChoiceQuestion {
    const criteria: Record<string, string> = { ...BASE_EMOJI };
    for (const emoji of customEmoji.slice(0, MAX_CUSTOM_EMOJI)) {
        criteria[customEmojiKey(emoji)] = `this server's own emoji named "${emoji.name}"`;
    }
    return {
        type: 'choice',
        instructions: `Which emoji reaction best fits \`${latestPath}.text\`, as a friend in the chat would react?`,
        criteria
    };
}

/** The server's usable custom emoji (Jev picks from these alongside BASE_EMOJI). */
export function guildCustomEmoji(guild: any): CustomEmoji[] {
    const emojis = guild?.emojis?.cache;
    if (!emojis) return [];
    return [...emojis.values()]
        .filter((e: any) => e.available !== false && e.name)
        .map((e: any) => ({ id: e.id, name: e.name, animated: e.animated }));
}

export function customEmojiKey(emoji: CustomEmoji): string {
    return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

/** Best emoji, steering away from ones used recently. */
export function pickEmoji(probabilities: Record<string, number>, recent: string[]): string | null {
    const recentSet = new Set(recent);
    return argmaxWeighted(probabilities, option => recentSet.has(option) ? RECENT_EMOJI_WEIGHT : 1);
}

/**
 * Ask Jev everything the ambient policy needs about the latest message, in
 * one request. `lines` must end with the latest human message.
 */
export async function judgeConversation(
    lines: ChatLine[],
    opts: { mode: string; channelName?: string; customEmoji: CustomEmoji[]; recentEmoji: string[] }
): Promise<GateJudgment> {
    const { recent, shortIds, persona, state } = buildState(lines, opts.mode, opts.channelName);
    const latest = `messages[${recent.length - 1}]`;
    const selfSpokeRecently = recent.some(line => line.isSelf);

    const candidates = recent.filter(line => !line.isSelf).slice(-TARGET_CANDIDATES);
    const targetCriteria: Record<string, string> = {};
    for (const line of candidates) {
        targetCriteria[shortIds.get(line.id)!] = `${line.authorName.split('/').pop()}: "${snippet(line.text, 60)}"`;
    }

    const questions = {
        addressed: {
            type: 'noul' as const,
            instructions: `Is \`${latest}\` addressed to ${persona}, by name or as a question or request directed at ${persona}?`
        },
        value: {
            type: 'score' as const,
            instructions: `If ${persona} (see \`about\`) joined the conversation in \`messages\` right now, how much would he add?`,
            criteria: [
                'Nothing: any reply would be noise, an interruption, or just agreeing',
                'A little: a pleasantry, a small aside, or a joke that is only mildly relevant',
                'Something: a genuinely useful fact, correction, or a joke that fits the moment well',
                'A lot: someone asked something nobody has answered, or said something wrong that he can clearly set right'
            ]
        },
        intrusive: {
            type: 'noul' as const,
            instructions: 'Is the conversation in `messages` personal, emotional, or private between specific people, '
                + 'so that someone else joining in would feel intrusive?'
        },
        responds: {
            type: 'noul' as const,
            instructions: `Does \`${latest}\` respond to something ${persona} said earlier in \`messages\`?`
        },
        reactable: {
            type: 'noul' as const,
            instructions: `Would a friend in this chat react to \`${latest}\` with an emoji — because it is funny, good or sad news, `
                + 'an announcement, an achievement, or something to agree with?'
        },
        emoji: emojiQuestion(latest, opts.customEmoji),
        ...(candidates.length > 1 ? {
            target: {
                type: 'choice' as const,
                instructions: `If ${persona} replied now, which message in \`messages\` would he most naturally be responding to?`,
                criteria: targetCriteria
            }
        } : {})
    };

    const answers = await systemOne(state, questions) as any;
    const targetShort: string | undefined = answers.target?.choice;
    const targetLine = targetShort
        ? candidates.find(line => shortIds.get(line.id) === targetShort)
        : candidates[candidates.length - 1];

    return {
        addressed: answers.addressed.noul,
        value: answers.value.score / 3,
        intrusive: answers.intrusive.noul,
        respondsToJeeves: selfSpokeRecently ? answers.responds.noul : 0,
        reactable: answers.reactable.noul,
        targetId: targetLine?.id ?? null,
        emoji: pickEmoji(answers.emoji.probabilities, opts.recentEmoji)
    };
}

/** Reaction mode: just pick the emoji for the latest message. */
export async function chooseReaction(
    lines: ChatLine[],
    opts: { mode: string; channelName?: string; customEmoji: CustomEmoji[]; recentEmoji: string[] }
): Promise<string | null> {
    const { recent, state } = buildState(lines, opts.mode, opts.channelName);
    if (!recent.length) return null;
    const answers = await systemOne(state, { emoji: emojiQuestion(`messages[${recent.length - 1}]`, opts.customEmoji) });
    return pickEmoji(answers.emoji.probabilities, opts.recentEmoji);
}
