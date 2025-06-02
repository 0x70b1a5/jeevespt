import fs from 'fs'
import { JEEVES_PROMPT } from './prompts';

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
    // Reaction mode configuration
    reactionModeEnabled: boolean;
    reactionChannels: string[];
    // Learning system configuration
    learningEnabled: boolean;
    learningSubjects: string[];
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
    lastQuestionTimes: Map<string, number>; // subject -> timestamp
    dailyQuestionCount: Map<string, number>; // subject -> count for today
    lastResetDate: string; // date string for tracking daily resets
}

export interface ReactionHistory {
    emoji: string;
    timestamp: number;
    messageContent: string; // truncated for context
    channelId: string;
}

export interface ReactionTracker {
    recentReactions: ReactionHistory[]; // circular buffer of last 5 reactions
}

export interface ScheduledReminder {
    id: string;
    userId: string;
    channelId: string;
    content: string;
    triggerTime: Date;
    recurring?: {
        interval: number; // milliseconds
        type: 'daily' | 'weekly' | 'custom';
    };
    isDM: boolean;
}

export type BotMode = 'jeeves' | 'tokipona' | 'jargon' | 'whisper' | 'customprompt';

export class BotState {
    private guildConfigs: Map<string, BotConfig> = new Map();
    private userConfigs: Map<string, BotConfig> = new Map();
    private guildBuffers: Map<string, MessageBuffer> = new Map();
    private userBuffers: Map<string, MessageBuffer> = new Map();
    private guildLogs: Map<string, MessageLog> = new Map();
    private userLogs: Map<string, MessageLog> = new Map();
    private customPrompts: Map<string, string> = new Map();
    private scheduledReminders: Map<string, ScheduledReminder> = new Map();
    private guildLearningTrackers: Map<string, LearningTracker> = new Map();
    private userLearningTrackers: Map<string, LearningTracker> = new Map();
    private guildReactionTrackers: Map<string, ReactionTracker> = new Map();
    private userReactionTrackers: Map<string, ReactionTracker> = new Map();

    private defaultConfig: BotConfig = {
        mode: 'jeeves',
        messageLimit: 20,
        temperature: 0.9,
        maxResponseLength: 1000,
        shouldSaveData: true,
        responseDelayMs: 10000,
        museInterval: 6 * 60 * 60 * 1000,
        shouldMuseRegularly: true,
        model: 'claude-3-5-sonnet-latest',
        allowDMs: true,
        useVoiceResponse: false,
        // Default reaction mode settings
        reactionModeEnabled: false,
        reactionChannels: [],
        // Default learning settings
        learningEnabled: false,
        learningSubjects: ['Latin', 'toki pona']
    };

    constructor() {
        // Load persisted data on startup
        this.loadPersistedData();
        this.loadReminders();
    }

    private getConfigKey(id: string, isDM: boolean): string {
        return `${isDM ? 'user' : 'guild'}:${id}`;
    }

    getConfig(id: string, isDM: boolean): BotConfig {
        const map = isDM ? this.userConfigs : this.guildConfigs;
        let config = map.get(id);

        if (!config) {
            console.log(`🎩 No config found for ${isDM ? 'DM' : 'guild'} (${id}). Creating new config.`);
            config = { ...this.defaultConfig };
            map.set(id, config);
        }

        return config;
    }

    getBuffer(id: string, isDM: boolean): MessageBuffer {
        const map = isDM ? this.userBuffers : this.guildBuffers;
        let buffer = map.get(id);

        if (!buffer) {
            console.log(`💬 No buffer found for ${isDM ? 'DM' : 'guild'} (${id}). Creating new buffer.`);
            buffer = {
                messages: [],
                lastMessageTimestamp: Date.now(),
                responseTimer: null
            };
            map.set(id, buffer);
        }

        return buffer;
    }

    updateConfig(id: string, isDM: boolean, updates: Partial<BotConfig>) {
        const config = this.getConfig(id, isDM);
        const newConfig = { ...config, ...updates };
        const map = isDM ? this.userConfigs : this.guildConfigs;
        map.set(id, newConfig);

        if (newConfig.shouldSaveData) {
            this.persistData(id, isDM);
        }
    }

    setCustomPrompt(id: string, isDM: boolean, prompt: string) {
        const key = this.getStorageKey(id, isDM);
        this.customPrompts.set(key, prompt);

        if (this.getConfig(id, isDM).shouldSaveData) {
            this.persistData(id, isDM);
        }
    }

    getCustomPrompt(id: string, isDM: boolean): string {
        const key = this.getStorageKey(id, isDM);
        return this.customPrompts.get(key) || JEEVES_PROMPT; // Default to Jeeves prompt if none set
    }

    private getStorageKey(id: string, isDM: boolean): string {
        return `${isDM ? 'user' : 'guild'}:${id}`;
    }

    private async loadPersistedData() {
        try {
            const files = await fs.promises.readdir('data');

            for (const file of files) {
                if (!file.endsWith('.json')) continue;

                const data = JSON.parse(
                    await fs.promises.readFile(`data/${file}`, 'utf8')
                );

                const [type, id] = file.replace('.json', '').split(':');
                const isDM = type === 'user';

                if (data.config) {
                    const map = isDM ? this.userConfigs : this.guildConfigs;
                    map.set(id, { ...this.defaultConfig, ...data.config });
                }

                if (data.messages) {
                    const map = isDM ? this.userLogs : this.guildLogs;
                    map.set(id, {
                        messages: data.messages,
                    });
                }

                if (data.customPrompt) {
                    this.customPrompts.set(`${type}:${id}`, data.customPrompt);
                }

                if (data.learningData) {
                    const map = isDM ? this.userLearningTrackers : this.guildLearningTrackers;
                    const tracker: LearningTracker = {
                        lastQuestionTimes: new Map(Object.entries(data.learningData.lastQuestionTimes || {})),
                        dailyQuestionCount: new Map(Object.entries(data.learningData.dailyQuestionCount || {})),
                        lastResetDate: data.learningData.lastResetDate || new Date().toDateString()
                    };
                    map.set(id, tracker);
                }

                if (data.reactionData) {
                    const map = isDM ? this.userReactionTrackers : this.guildReactionTrackers;
                    const tracker: ReactionTracker = {
                        recentReactions: data.reactionData.recentReactions || []
                    };
                    map.set(id, tracker);
                }
            }
        } catch (error) {
            console.error('Error loading persisted data:', error);
        }
    }

    async persistData(id: string, isDM: boolean) {
        try {
            const key = this.getStorageKey(id, isDM);
            const config = this.getConfig(id, isDM);
            const log = this.getLog(id, isDM);
            const customPrompt = this.customPrompts.get(key);
            const learningTracker = this.getLearningTracker(id, isDM);
            const reactionTracker = this.getReactionTracker(id, isDM);

            // Convert Maps to objects for JSON serialization
            const learningData = {
                lastQuestionTimes: Object.fromEntries(learningTracker.lastQuestionTimes),
                dailyQuestionCount: Object.fromEntries(learningTracker.dailyQuestionCount),
                lastResetDate: learningTracker.lastResetDate
            };

            const reactionData = {
                recentReactions: reactionTracker.recentReactions
            };

            const data = {
                config,
                messages: log.messages,
                customPrompt,
                learningData,
                reactionData,
                lastUpdate: Date.now()
            };

            await fs.promises.mkdir('data', { recursive: true });
            await fs.promises.writeFile(
                `data/${key}.json`,
                JSON.stringify(data, null, 2)
            );
        } catch (error) {
            console.error(`Error persisting data for ${isDM ? 'user' : 'guild'} ${id}:`, error);
        }
    }

    getAllDMConfigs(): [string, BotConfig][] {
        return Array.from(this.userConfigs.entries());
    }

    getLog(id: string, isDM: boolean): MessageLog {
        const map = isDM ? this.userLogs : this.guildLogs;
        let log = map.get(id);

        if (!log) {
            console.log(`💬 No log found for ${isDM ? 'DM' : 'guild'} (${id}). Creating new log.`);
            log = { messages: [] };
            map.set(id, log);
        }

        return log;
    }

    // Reminder management methods
    addReminder(reminder: ScheduledReminder) {
        this.scheduledReminders.set(reminder.id, reminder);
        // Persist immediately
        this.persistReminders();
    }

    removeReminder(id: string): boolean {
        const deleted = this.scheduledReminders.delete(id);
        if (deleted) {
            this.persistReminders();
        }
        return deleted;
    }

    getReminder(id: string): ScheduledReminder | undefined {
        return this.scheduledReminders.get(id);
    }

    getAllReminders(): ScheduledReminder[] {
        return Array.from(this.scheduledReminders.values());
    }

    getRemindersForUser(userId: string): ScheduledReminder[] {
        return Array.from(this.scheduledReminders.values())
            .filter(reminder => reminder.userId === userId);
    }

    private async persistReminders() {
        try {
            const remindersData = Array.from(this.scheduledReminders.entries()).map(([id, reminder]) => ({
                ...reminder,
                triggerTime: reminder.triggerTime.toISOString()
            }));

            await fs.promises.mkdir('data', { recursive: true });
            await fs.promises.writeFile(
                'data/reminders.json',
                JSON.stringify(remindersData, null, 2)
            );
        } catch (error) {
            console.error('Error persisting reminders:', error);
        }
    }

    private async loadReminders() {
        try {
            const data = await fs.promises.readFile('data/reminders.json', 'utf8');
            const remindersData = JSON.parse(data);

            for (const reminderData of remindersData) {
                const reminder: ScheduledReminder = {
                    ...reminderData,
                    triggerTime: new Date(reminderData.triggerTime)
                };
                this.scheduledReminders.set(reminder.id, reminder);
            }

            console.log(`📅 Loaded ${this.scheduledReminders.size} reminders`);
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error('Error loading reminders:', error);
            }
        }
    }

    // Learning tracker management methods
    getLearningTracker(id: string, isDM: boolean): LearningTracker {
        const map = isDM ? this.userLearningTrackers : this.guildLearningTrackers;
        let tracker = map.get(id);

        if (!tracker) {
            console.log(`📚 No learning tracker found for ${isDM ? 'DM' : 'guild'} (${id}). Creating new tracker.`);
            tracker = {
                lastQuestionTimes: new Map(),
                dailyQuestionCount: new Map(),
                lastResetDate: new Date().toDateString()
            };
            map.set(id, tracker);
        }

        // Reset daily counts if it's a new day
        const today = new Date().toDateString();
        if (tracker.lastResetDate !== today) {
            tracker.dailyQuestionCount.clear();
            tracker.lastResetDate = today;
        }

        return tracker;
    }

    recordQuestionAsked(id: string, isDM: boolean, subject: string) {
        const tracker = this.getLearningTracker(id, isDM);
        const now = Date.now();

        tracker.lastQuestionTimes.set(subject, now);
        tracker.dailyQuestionCount.set(subject, (tracker.dailyQuestionCount.get(subject) || 0) + 1);

        // Persist the data
        if (this.getConfig(id, isDM).shouldSaveData) {
            this.persistData(id, isDM);
        }
    }

    getTimeUntilNextQuestion(id: string, isDM: boolean, subjects: string[]): number {
        if (subjects.length === 0) return Infinity;

        const tracker = this.getLearningTracker(id, isDM);
        const hoursPerQuestion = 24 / subjects.length; // Space questions throughout the day
        const intervalMs = hoursPerQuestion * 60 * 60 * 1000;

        // Find the subject that should be asked next (least recently asked)
        let earliestTime = Infinity;
        for (const subject of subjects) {
            const lastTime = tracker.lastQuestionTimes.get(subject) || 0;
            const nextTime = lastTime + intervalMs;
            if (nextTime < earliestTime) {
                earliestTime = nextTime;
            }
        }

        return Math.max(0, earliestTime - Date.now());
    }

    getNextQuestionSubject(id: string, isDM: boolean, subjects: string[]): string | null {
        if (subjects.length === 0) return null;

        const tracker = this.getLearningTracker(id, isDM);
        const hoursPerQuestion = 24 / subjects.length;
        const intervalMs = hoursPerQuestion * 60 * 60 * 1000;
        const now = Date.now();

        // Find the subject that should be asked next (least recently asked and due)
        let nextSubject = null;
        let earliestDueTime = Infinity;

        for (const subject of subjects) {
            const lastTime = tracker.lastQuestionTimes.get(subject) || 0;
            const nextTime = lastTime + intervalMs;

            if (nextTime <= now && nextTime < earliestDueTime) {
                earliestDueTime = nextTime;
                nextSubject = subject;
            }
        }

        return nextSubject;
    }

    // Reaction tracker management methods
    getReactionTracker(id: string, isDM: boolean): ReactionTracker {
        const map = isDM ? this.userReactionTrackers : this.guildReactionTrackers;
        let tracker = map.get(id);

        if (!tracker) {
            console.log(`🎭 No reaction tracker found for ${isDM ? 'DM' : 'guild'} (${id}). Creating new tracker.`);
            tracker = {
                recentReactions: []
            };
            map.set(id, tracker);
        }

        return tracker;
    }

    recordReaction(id: string, isDM: boolean, emoji: string, messageContent: string, channelId: string) {
        const tracker = this.getReactionTracker(id, isDM);

        // Truncate message content for storage (keep it reasonably short)
        const truncatedContent = messageContent.length > 100
            ? messageContent.substring(0, 100) + '...'
            : messageContent;

        const reactionHistory: ReactionHistory = {
            emoji,
            timestamp: Date.now(),
            messageContent: truncatedContent,
            channelId
        };

        // Add to beginning of array and keep only last 5
        tracker.recentReactions.unshift(reactionHistory);
        if (tracker.recentReactions.length > 5) {
            tracker.recentReactions = tracker.recentReactions.slice(0, 5);
        }

        // Persist the data
        if (this.getConfig(id, isDM).shouldSaveData) {
            this.persistData(id, isDM);
        }
    }

    getRecentReactions(id: string, isDM: boolean): ReactionHistory[] {
        const tracker = this.getReactionTracker(id, isDM);
        return tracker.recentReactions;
    }
}