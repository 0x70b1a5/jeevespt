/**
 * Shared types for state management
 */

export enum ResponseFrequency {
    None = 'none',
    EveryMessage = 'all',
    WhenMentioned = 'mentions'
}

export interface ChannelMembershipConfig {
    responseFrequency: ResponseFrequency;
}

export interface AutotranslateChannel {
    channelId: string;
    language: string;
}

export interface AutotranslateUser {
    userId: string;
    language: string;
}

export interface MessageBuffer {
    messages: { role: string; content: string }[];
    lastMessageTimestamp: number;
    responseTimer: NodeJS.Timeout | null;
}

export interface MessageLog {
    messages: { role: string; content: string }[];
}

export interface LearningTracker {
    lastQuestionTimes: Map<string, number>;
    dailyQuestionCount: Map<string, number>;
    lastResetDate: string;
}

export interface ReactionHistory {
    emoji: string;
    timestamp: number;
    messageContent: string;
    channelId: string;
}

export interface ReactionTracker {
    recentReactions: ReactionHistory[];
}

export interface ScheduledReminder {
    id: string;
    userId: string;
    channelId: string;
    content: string;
    triggerTime: Date;
    recurring?: {
        interval: number;
        type: 'daily' | 'weekly' | 'custom';
    };
    isDM: boolean;
}

/**
 * Structured recurrence rule produced by the natural-language task parser.
 * Absent on one-shot tasks.
 */
export type TaskRecurrence =
    | { type: 'interval'; intervalMs: number }
    | { type: 'daily'; hour: number; minute: number }
    | { type: 'weekly'; dayOfWeek: number; hour: number; minute: number }
    | { type: 'monthly'; dayOfMonth: number; hour: number; minute: number };

export interface ScheduledTask {
    id: string;
    userId: string;
    channelId: string;
    isDM: boolean;
    /** What the agent should actually do when fired. */
    instructions: string;
    /** Original schedule phrase the user typed, for display. */
    rawScheduleText: string;
    nextRun: Date;
    recurrence?: TaskRecurrence;
    createdAt: Date;
    lastRun?: Date;
    /** Consecutive failed agent runs; resets on success. */
    consecutiveFailures: number;
    /** True after MAX_TASK_FAILURES consecutive failures; no further runs until manually cancelled. */
    paused: boolean;
}

export type BotMode = 'jeeves' | 'tokipona' | 'whisper' | 'customprompt' | 'lugso';

export interface BotConfig {
    mode: BotMode;
    messageLimit: number;
    temperature: number;
    maxResponseLength: number;
    shouldSaveData: boolean;
    responseDelayMs: number;
    museInterval: number;
    shouldMuseRegularly: boolean;
    model: string;
    allowDMs: boolean;
    useVoiceResponse: boolean;
    reactionModeEnabled: boolean;
    reactionChannels: string[];
    learningEnabled: boolean;
    learningSubjects: string[];
    channelMemberships: Map<string, ChannelMembershipConfig>;
    autotranslateChannels: AutotranslateChannel[];
    autotranslateUsers: AutotranslateUser[];
    transcriptionSpeedScalar: number;
    /** When enabled, only admins can change settings/run commands */
    adminMode: boolean;
    /** Commands that non-admins can still run when adminMode is enabled */
    commandWhitelist: string[];
    /** When enabled, adds 3000 thinking tokens to LLM API calls */
    extendedThinking: boolean;
    /** When enabled, grants the model the server-side web_search tool */
    webSearchEnabled: boolean;
    /** Maximum web searches the model may perform per response */
    webSearchMaxUses: number;
}

// Valid Anthropic Claude models
export const VALID_ANTHROPIC_MODELS = [
    // Current models
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-5',
    'claude-haiku-4-5-20251001',
    'claude-haiku-4-5',
    'claude-opus-4-1-20250805',
    'claude-opus-4-1',
    // Legacy models
    'claude-sonnet-4-20250514',
    'claude-sonnet-4-0',
    'claude-3-7-sonnet-20250219',
    'claude-3-7-sonnet-latest',
    'claude-opus-4-20250514',
    'claude-opus-4-0',
] as const;

export function isValidAnthropicModel(model: string): boolean {
    return VALID_ANTHROPIC_MODELS.includes(model as any);
}

/** Whether this model id should be served by the xAI (Grok) API. */
export function isXaiModel(model: string): boolean {
    return model.startsWith('grok-');
}

/** Whether this model id should be served by the Hermes/Nous API. */
export function isHermesModel(model: string): boolean {
    return model.startsWith('hermes-') || model.startsWith('poolside/') || model.startsWith('nous/');
}

// Valid xAI Grok models (static fallback; !model also fetches live list)
export const VALID_XAI_MODELS = [
    'grok-4.5',
    'grok-4.3',
    'grok-4.20-0309-reasoning',
    'grok-4.20-0309-non-reasoning',
    'grok-4',
    'grok-3',
    'grok-3-mini',
    'grok-3-fast',
    'grok-3-mini-fast',
    'grok-2',
    'grok-2-latest',
] as const;

export function isValidXaiModel(model: string): boolean {
    return VALID_XAI_MODELS.includes(model as any) || isXaiModel(model);
}

/** Combined static model list used when live API fetch is unavailable. */
export const VALID_MODELS = [
    ...VALID_ANTHROPIC_MODELS,
    ...VALID_XAI_MODELS,
    // Poolside/Hermes models
    'poolside/laguna-m.1',
    'poolside/laguna-xs-2.1',
    'poolside/laguna-s-2.1',
] as const;

export function isValidModel(model: string): boolean {
    return isValidAnthropicModel(model) || isValidXaiModel(model) || isHermesModel(model);
}
