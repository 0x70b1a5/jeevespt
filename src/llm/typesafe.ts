/**
 * Minimal client for TypeSafe's System One API (the Jev model).
 *
 * Jev doesn't generate text: it answers typed questions about a `state` with
 * calibrated probabilities (~100 ms, fractions of a cent). We use it for the
 * small judgments code can't make — should Jeeves chime in, which message,
 * which emoji — and keep all arithmetic and policy in code.
 * Docs: https://docs.typesafe.ai/api
 */

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const TIMEOUT_MS = 8000;
const RETRY_STATUSES = new Set([429, 529]);
const MAX_ATTEMPTS = 3;

export type NoulQuestion = {
    type: 'noul';
    instructions: string;
    criteria?: { true?: string; false?: string };
};
export type ChoiceQuestion = {
    type: 'choice';
    instructions: string;
    /** option → description (null when the option name says it all). Max 255. */
    criteria: Record<string, string | null>;
};
export type ScoreQuestion = {
    type: 'score';
    instructions: string;
    /** Ordered levels, lowest first. 2–10. */
    criteria: string[];
};
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = { type: 'noul'; noul: number };
export type ChoiceAnswer = { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number };
export type ScoreAnswer = { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number };

type AnswerFor<Q> = Q extends NoulQuestion ? NoulAnswer : Q extends ChoiceQuestion ? ChoiceAnswer : ScoreAnswer;
export type Answers<Qs extends Record<string, Question>> = { [K in keyof Qs]: AnswerFor<Qs[K]> };

export function isTypesafeConfigured(): boolean {
    return Boolean(process.env.TYPESAFE_API_KEY);
}

/**
 * Ask every question about one state in a single request (they run in
 * parallel on Jev's side and can't see each other's answers).
 * Retries 429/529 with backoff; throws on anything else.
 */
export async function systemOne<Qs extends Record<string, Question>>(
    state: unknown,
    questions: Qs
): Promise<Answers<Qs>> {
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) throw new Error('TYPESAFE_API_KEY is not set');

    const body = JSON.stringify({ model: MODEL, state, questions });
    for (let attempt = 1; ; attempt++) {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (response.ok) {
            const json = await response.json() as { answers: Answers<Qs> };
            return json.answers;
        }
        if (RETRY_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
            const retryAfter = Number(response.headers.get('retry-after'));
            const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
            await new Promise(resolve => setTimeout(resolve, waitMs));
            continue;
        }
        const detail = await response.text().catch(() => '');
        throw new Error(`TypeSafe ${response.status}: ${detail.slice(0, 300)}`);
    }
}

/** The highest-probability option after multiplying each by a weight (default 1). */
export function argmaxWeighted(probabilities: Record<string, number>, weight: (option: string) => number = () => 1): string | null {
    let best: string | null = null;
    let bestValue = -1;
    for (const [option, p] of Object.entries(probabilities)) {
        const value = p * weight(option);
        if (value > bestValue) {
            best = option;
            bestValue = value;
        }
    }
    return best;
}
