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

export type BotMode = 'jeeves' | 'tokipona' | 'whisper' | 'customprompt';

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
    'claude-3-5-haiku-20241022',
    'claude-3-5-haiku-latest',
    'claude-3-haiku-20240307',
    // Older legacy models (for backwards compatibility)
    'claude-3-5-sonnet-latest',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-sonnet-20240620',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229'
] as const;

export function isValidAnthropicModel(model: string): boolean {
    return VALID_ANTHROPIC_MODELS.includes(model as any);
}
