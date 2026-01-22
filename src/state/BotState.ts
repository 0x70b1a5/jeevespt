import fs from 'fs';
import { JEEVES_PROMPT } from '../prompts/prompts';
import {
    BotConfig, BotMode, MessageBuffer, MessageLog,
    ChannelMembershipConfig, AutotranslateChannel, AutotranslateUser,
    ScheduledReminder, LearningTracker, ReactionHistory
} from './types';
import { ReminderStore } from './ReminderStore';
import { LearningStore } from './LearningStore';
import { ReactionStore } from './ReactionStore';
import { AutotranslateStore } from './AutotranslateStore';

/**
 * BotState - Central state management for the bot
 *
 * Uses extracted stores for specific concerns while maintaining
 * backwards-compatible API.
 */
export class BotState {
    // Core state maps
    private guildConfigs: Map<string, BotConfig> = new Map();
    private userConfigs: Map<string, BotConfig> = new Map();
    private guildBuffers: Map<string, MessageBuffer> = new Map();
    private userBuffers: Map<string, MessageBuffer> = new Map();
    private guildLogs: Map<string, MessageLog> = new Map();
    private userLogs: Map<string, MessageLog> = new Map();
    private customPrompts: Map<string, string> = new Map();

    // Extracted stores
    private reminderStore: ReminderStore;
    private learningStore: LearningStore;
    private reactionStore: ReactionStore;

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
        reactionModeEnabled: false,
        reactionChannels: [],
        learningEnabled: false,
        learningSubjects: ['Latin', 'toki pona'],
        channelMemberships: new Map(),
        autotranslateChannels: [],
        autotranslateUsers: [],
        transcriptionSpeedScalar: 1.0,
        adminMode: false,
        commandWhitelist: ['help']
    };

    constructor() {
        this.reminderStore = new ReminderStore();
        this.learningStore = new LearningStore();
        this.reactionStore = new ReactionStore();
        this.loadPersistedData();
    }

    // ==================== Config Management ====================

    private getStorageKey(id: string, isDM: boolean): string {
        return `${isDM ? 'user' : 'guild'}:${id}`;
    }

    getConfig(id: string, isDM: boolean): BotConfig {
        const map = isDM ? this.userConfigs : this.guildConfigs;
        let config = map.get(id);

        if (!config) {
            console.log(`🎩 No config found for ${isDM ? 'DM' : 'guild'} (${id}). Creating new config.`);
            config = { ...this.defaultConfig, channelMemberships: new Map() };
            map.set(id, config);
        }

        return config;
    }

    updateConfig(id: string, isDM: boolean, updates: Partial<BotConfig>): void {
        const config = this.getConfig(id, isDM);
        const newConfig = { ...config, ...updates };
        const map = isDM ? this.userConfigs : this.guildConfigs;
        map.set(id, newConfig);

        if (newConfig.shouldSaveData) {
            this.persistData(id, isDM);
        }
    }

    getAllDMConfigs(): [string, BotConfig][] {
        return Array.from(this.userConfigs.entries());
    }

    // ==================== Buffer Management ====================

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

    // ==================== Log Management ====================

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

    // ==================== Custom Prompts ====================

    setCustomPrompt(id: string, isDM: boolean, prompt: string): void {
        const key = this.getStorageKey(id, isDM);
        this.customPrompts.set(key, prompt);

        if (this.getConfig(id, isDM).shouldSaveData) {
            this.persistData(id, isDM);
        }
    }

    getCustomPrompt(id: string, isDM: boolean): string {
        const key = this.getStorageKey(id, isDM);
        return this.customPrompts.get(key) || JEEVES_PROMPT;
    }

    // ==================== Reminder Delegation ====================

    addReminder(reminder: ScheduledReminder): void {
        this.reminderStore.add(reminder);
    }

    removeReminder(id: string): boolean {
        return this.reminderStore.remove(id);
    }

    getReminder(id: string): ScheduledReminder | undefined {
        return this.reminderStore.get(id);
    }

    getAllReminders(): ScheduledReminder[] {
        return this.reminderStore.getAll();
    }

    getRemindersForUser(userId: string): ScheduledReminder[] {
        return this.reminderStore.getForUser(userId);
    }

    // ==================== Learning Delegation ====================

    getLearningTracker(id: string, isDM: boolean): LearningTracker {
        return this.learningStore.getTracker(id, isDM);
    }

    recordQuestionAsked(id: string, isDM: boolean, subject: string): void {
        this.learningStore.recordQuestionAsked(id, isDM, subject);
        if (this.getConfig(id, isDM).shouldSaveData) {
            this.persistData(id, isDM);
        }
    }

    getTimeUntilNextQuestion(id: string, isDM: boolean, subjects: string[]): number {
        return this.learningStore.getTimeUntilNextQuestion(id, isDM, subjects);
    }

    getNextQuestionSubject(id: string, isDM: boolean, subjects: string[]): string | null {
        return this.learningStore.getNextQuestionSubject(id, isDM, subjects);
    }

    // ==================== Reaction Delegation ====================

    getReactionTracker(id: string, isDM: boolean) {
        return this.reactionStore.getTracker(id, isDM);
    }

    recordReaction(id: string, isDM: boolean, emoji: string, messageContent: string, channelId: string): void {
        this.reactionStore.recordReaction(id, isDM, emoji, messageContent, channelId);
        if (this.getConfig(id, isDM).shouldSaveData) {
            this.persistData(id, isDM);
        }
    }

    getRecentReactions(id: string, isDM: boolean): ReactionHistory[] {
        return this.reactionStore.getRecentReactions(id, isDM);
    }

    // ==================== Channel Membership ====================

    setChannelMembership(id: string, isDM: boolean, channelId: string, membership: ChannelMembershipConfig): void {
        const config = this.getConfig(id, isDM);
        config.channelMemberships.set(channelId, membership);

        if (config.shouldSaveData) {
            this.persistData(id, isDM);
        }
    }

    getChannelMembership(id: string, isDM: boolean, channelId: string): ChannelMembershipConfig | undefined {
        const config = this.getConfig(id, isDM);
        return config.channelMemberships.get(channelId);
    }

    removeChannelMembership(id: string, isDM: boolean, channelId: string): boolean {
        const config = this.getConfig(id, isDM);
        const deleted = config.channelMemberships.delete(channelId);

        if (deleted && config.shouldSaveData) {
            this.persistData(id, isDM);
        }

        return deleted;
    }

    getAllChannelMemberships(id: string, isDM: boolean): Map<string, ChannelMembershipConfig> {
        const config = this.getConfig(id, isDM);
        return config.channelMemberships;
    }

    // ==================== Autotranslate Delegation ====================

    addAutotranslateChannel(id: string, isDM: boolean, channelId: string, language: string): void {
        const config = this.getConfig(id, isDM);
        AutotranslateStore.addChannel(config, channelId, language);
        if (config.shouldSaveData) {
            this.persistData(id, isDM);
        }
    }

    removeAutotranslateChannel(id: string, isDM: boolean, channelId: string): boolean {
        const config = this.getConfig(id, isDM);
        const removed = AutotranslateStore.removeChannel(config, channelId);
        if (removed && config.shouldSaveData) {
            this.persistData(id, isDM);
        }
        return removed;
    }

    getAutotranslateLanguage(id: string, isDM: boolean, channelId: string): string | null {
        const config = this.getConfig(id, isDM);
        return AutotranslateStore.getChannelLanguage(config, channelId);
    }

    getAllAutotranslateChannels(id: string, isDM: boolean): AutotranslateChannel[] {
        const config = this.getConfig(id, isDM);
        return AutotranslateStore.getAllChannels(config);
    }

    addAutotranslateUser(id: string, isDM: boolean, userId: string, language: string): void {
        const config = this.getConfig(id, isDM);
        AutotranslateStore.addUser(config, userId, language);
        if (config.shouldSaveData) {
            this.persistData(id, isDM);
        }
    }

    removeAutotranslateUser(id: string, isDM: boolean, userId: string, language?: string): boolean {
        const config = this.getConfig(id, isDM);
        const removed = AutotranslateStore.removeUser(config, userId, language);
        if (removed && config.shouldSaveData) {
            this.persistData(id, isDM);
        }
        return removed;
    }

    getAutotranslateUserLanguages(id: string, isDM: boolean, userId: string): string[] {
        const config = this.getConfig(id, isDM);
        return AutotranslateStore.getUserLanguages(config, userId);
    }

    getAllAutotranslateUsers(id: string, isDM: boolean): AutotranslateUser[] {
        const config = this.getConfig(id, isDM);
        return AutotranslateStore.getAllUsers(config);
    }

    // ==================== Persistence ====================

    private async loadPersistedData(): Promise<void> {
        try {
            const files = await fs.promises.readdir('data');

            for (const file of files) {
                if (!file.endsWith('.json') || file === 'reminders.json') continue;

                const data = JSON.parse(
                    await fs.promises.readFile(`data/${file}`, 'utf8')
                );

                const [type, id] = file.replace('.json', '').split(':');
                const isDM = type === 'user';

                if (data.config) {
                    const map = isDM ? this.userConfigs : this.guildConfigs;
                    const config = { ...this.defaultConfig, ...data.config };
                    if (data.config.channelMemberships) {
                        config.channelMemberships = new Map(Object.entries(data.config.channelMemberships));
                    }
                    map.set(id, config);
                }

                if (data.messages) {
                    const map = isDM ? this.userLogs : this.guildLogs;
                    map.set(id, { messages: data.messages });
                }

                if (data.customPrompt) {
                    this.customPrompts.set(`${type}:${id}`, data.customPrompt);
                }

                if (data.learningData) {
                    this.learningStore.load(id, isDM, data.learningData);
                }

                if (data.reactionData) {
                    this.reactionStore.load(id, isDM, data.reactionData);
                }
            }
        } catch (error) {
            console.error('Error loading persisted data:', error);
        }
    }

    async persistData(id: string, isDM: boolean): Promise<void> {
        try {
            const key = this.getStorageKey(id, isDM);
            const config = this.getConfig(id, isDM);
            const log = this.getLog(id, isDM);
            const customPrompt = this.customPrompts.get(key);

            const learningData = this.learningStore.serialize(id, isDM);
            const reactionData = this.reactionStore.serialize(id, isDM);

            const configForSerialization = {
                ...config,
                channelMemberships: Object.fromEntries(config.channelMemberships)
            };

            const data = {
                config: configForSerialization,
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
}
