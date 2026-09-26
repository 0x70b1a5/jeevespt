/**
 * Ambient participation policy: when an unaddressed Jeeves may speak.
 *
 * Jev (see gate.ts) judges the conversation; this file owns the arithmetic.
 *
 * • Budget. Each human message earns credit `sociability × engagement ÷ S`,
 *   where S is the number of people talking in the channel over the last half
 *   hour. At sociability 1 that's a fair share of the conversation (one
 *   message per S human messages, like any other participant); at 0 he only
 *   speaks when addressed. A reply costs 1 credit, a reaction ¼.
 * • Engagement. Unprompted messages that get a reply, reaction or response
 *   raise a per-channel multiplier; ones that are ignored lower it, so the
 *   rate settles on what the channel actually welcomes.
 * • Eagerness. The "worth saying" bar also drops as sociability rises.
 */

export const ACTIVITY_WINDOW_MS = 30 * 60_000;
export const REPLY_COST = 1;
export const REACT_COST = 0.25;
export const CREDIT_CAP = 1.5;
export const FEEDBACK_WINDOW_MS = 10 * 60_000;
export const ENGAGEMENT_MIN = 0.3;
export const ENGAGEMENT_MAX = 1.5;
export const ENGAGEMENT_UP = 1.2;
export const ENGAGEMENT_DOWN = 0.8;

/** Addressed-by-name probability above which he answers regardless of budget. */
export const ADDRESSED_THRESHOLD = 0.7;
/** Reaction-worthiness probability needed to react. */
export const REACT_THRESHOLD = 0.6;
/** …lower when the message answers him ("thanks!"): acknowledge it, as a person would. */
export const REACT_TO_RESPONSE_THRESHOLD = 0.3;
/** Probability that a message responds to Jeeves, to count as engagement. */
export const RESPONDS_THRESHOLD = 0.7;

/** Minimum reply score (0–1) to chime in: 0.85 at sociability 0, 0.5 at 1. */
export function replyThreshold(sociability: number): number {
    return 0.85 - 0.35 * clamp(sociability, 0, 1);
}

interface ChannelActivity {
    humans: { ts: number; authorId: string }[];
    credit: number;
    engagement: number;
    /** Our unprompted messages still waiting to see if anyone responds. */
    pending: { messageId: string; ts: number }[];
}

export class AmbientTracker {
    private channels = new Map<string, ChannelActivity>();

    constructor(private now: () => number = Date.now) {}

    private get(channelId: string): ChannelActivity {
        let activity = this.channels.get(channelId);
        if (!activity) {
            activity = { humans: [], credit: 0, engagement: 1, pending: [] };
            this.channels.set(channelId, activity);
        }
        return activity;
    }

    /** A person spoke: prune the window and earn credit. */
    recordHuman(channelId: string, authorId: string, sociability: number): void {
        const activity = this.get(channelId);
        const now = this.now();
        activity.humans = activity.humans.filter(h => now - h.ts < ACTIVITY_WINDOW_MS);
        activity.humans.push({ ts: now, authorId });
        const earned = clamp(sociability, 0, 1) * activity.engagement / this.activeSpeakers(channelId);
        activity.credit = Math.min(CREDIT_CAP, activity.credit + earned);
    }

    /** Distinct people who spoke in the window (at least 1). */
    activeSpeakers(channelId: string): number {
        const now = this.now();
        const authors = new Set(this.get(channelId).humans.filter(h => now - h.ts < ACTIVITY_WINDOW_MS).map(h => h.authorId));
        return Math.max(1, authors.size);
    }

    credit(channelId: string): number {
        return this.get(channelId).credit;
    }

    spend(channelId: string, cost: number): void {
        const activity = this.get(channelId);
        activity.credit = Math.max(0, activity.credit - cost);
    }

    engagement(channelId: string): number {
        return this.get(channelId).engagement;
    }

    /** We spoke unprompted; watch for a response. */
    recordUnprompted(channelId: string, messageId: string): void {
        this.get(channelId).pending.push({ messageId, ts: this.now() });
    }

    isPending(channelId: string, messageId: string): boolean {
        return this.get(channelId).pending.some(p => p.messageId === messageId);
    }

    /**
     * Someone responded to one of our unprompted messages (a specific one, or
     * the latest when we only know "they're talking to Jeeves"). Returns
     * whether it counted.
     */
    noteEngagement(channelId: string, messageId?: string): boolean {
        this.expire(channelId);
        const activity = this.get(channelId);
        const index = messageId
            ? activity.pending.findIndex(p => p.messageId === messageId)
            : activity.pending.length - 1;
        if (index < 0) return false;
        activity.pending.splice(index, 1);
        activity.engagement = Math.min(ENGAGEMENT_MAX, activity.engagement * ENGAGEMENT_UP);
        return true;
    }

    /** Unprompted messages nobody answered in time lower the multiplier. */
    expire(channelId: string): void {
        const activity = this.get(channelId);
        const now = this.now();
        const expired = activity.pending.filter(p => now - p.ts >= FEEDBACK_WINDOW_MS);
        if (!expired.length) return;
        activity.pending = activity.pending.filter(p => now - p.ts < FEEDBACK_WINDOW_MS);
        activity.engagement = Math.max(ENGAGEMENT_MIN, activity.engagement * ENGAGEMENT_DOWN ** expired.length);
    }
}

/** Jev's judgments, already reduced to numbers (see gate.ts). */
export interface GateJudgment {
    /** P(the latest message is addressed to Jeeves). */
    addressed: number;
    /** How much he could add, 0 (nothing) – 1 (resolves an open question). */
    value: number;
    /** P(joining would intrude on something personal). */
    intrusive: number;
    /** P(the latest message responds to something Jeeves said). */
    respondsToJeeves: number;
    /** P(the latest message merits an emoji reaction). */
    reactable: number;
    /** Message he'd reply to. */
    targetId: string | null;
    /** Best emoji for the latest message. */
    emoji: string | null;
}

export type GateDecision =
    | { action: 'reply'; targetId: string | null; direct: boolean; reason: string }
    | { action: 'react'; emoji: string; reason: string }
    | { action: 'none'; reason: string };

export function decide(
    judgment: GateJudgment,
    opts: { credit: number; sociability: number; reactionsAllowed: boolean }
): GateDecision {
    const f = (n: number) => n.toFixed(2);
    if (judgment.addressed >= ADDRESSED_THRESHOLD) {
        return { action: 'reply', targetId: null, direct: true, reason: `addressed ${f(judgment.addressed)}` };
    }

    const score = judgment.value * (1 - judgment.intrusive);
    const bar = replyThreshold(opts.sociability);
    const scoreNote = `score ${f(score)} (value ${f(judgment.value)} × not-intrusive ${f(1 - judgment.intrusive)}) vs bar ${f(bar)}, credit ${f(opts.credit)}`;
    if (score >= bar && opts.credit >= REPLY_COST) {
        return { action: 'reply', targetId: judgment.targetId, direct: false, reason: scoreNote };
    }

    const reactBar = judgment.respondsToJeeves >= RESPONDS_THRESHOLD ? REACT_TO_RESPONSE_THRESHOLD : REACT_THRESHOLD;
    if (opts.reactionsAllowed && judgment.emoji && judgment.reactable >= reactBar && opts.credit >= REACT_COST) {
        return { action: 'react', emoji: judgment.emoji, reason: `reactable ${f(judgment.reactable)}; ${scoreNote}` };
    }

    return { action: 'none', reason: `reactable ${f(judgment.reactable)}; ${scoreNote}` };
}

/** Median length in words of recent human messages — the register to match. */
export function medianWords(texts: string[]): number {
    const counts = texts.map(t => t.split(/\s+/).filter(Boolean).length).filter(n => n > 0).sort((a, b) => a - b);
    if (!counts.length) return 15;
    const mid = Math.floor(counts.length / 2);
    return counts.length % 2 ? counts[mid] : Math.round((counts[mid - 1] + counts[mid]) / 2);
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n));
}
