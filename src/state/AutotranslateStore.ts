import { AutotranslateChannel, AutotranslateUser, BotConfig } from './types';

/**
 * Store for managing autotranslate configuration
 * Note: This is embedded in BotConfig, so this class provides helper methods
 */
export class AutotranslateStore {
    /**
     * Add or update a channel for autotranslate
     */
    static addChannel(config: BotConfig, channelId: string, language: string): void {
        const existingIndex = config.autotranslateChannels.findIndex(
            ch => ch.channelId === channelId
        );

        if (existingIndex >= 0) {
            config.autotranslateChannels[existingIndex].language = language;
        } else {
            config.autotranslateChannels.push({ channelId, language });
        }
    }

    /**
     * Remove a channel from autotranslate
     */
    static removeChannel(config: BotConfig, channelId: string): boolean {
        const initialLength = config.autotranslateChannels.length;
        config.autotranslateChannels = config.autotranslateChannels.filter(
            ch => ch.channelId !== channelId
        );
        return config.autotranslateChannels.length < initialLength;
    }

    /**
     * Get language for a channel
     */
    static getChannelLanguage(config: BotConfig, channelId: string): string | null {
        const channel = config.autotranslateChannels.find(ch => ch.channelId === channelId);
        return channel?.language || null;
    }

    /**
     * Get all autotranslate channels
     */
    static getAllChannels(config: BotConfig): AutotranslateChannel[] {
        return config.autotranslateChannels;
    }

    /**
     * Add a user language preference
     */
    static addUser(config: BotConfig, userId: string, language: string): void {
        const exists = config.autotranslateUsers.some(
            user => user.userId === userId && user.language.toLowerCase() === language.toLowerCase()
        );

        if (!exists) {
            config.autotranslateUsers.push({ userId, language });
        }
    }

    /**
     * Remove user language preference(s)
     */
    static removeUser(config: BotConfig, userId: string, language?: string): boolean {
        const initialLength = config.autotranslateUsers.length;

        if (language) {
            config.autotranslateUsers = config.autotranslateUsers.filter(
                user => !(user.userId === userId && user.language.toLowerCase() === language.toLowerCase())
            );
        } else {
            config.autotranslateUsers = config.autotranslateUsers.filter(
                user => user.userId !== userId
            );
        }

        return config.autotranslateUsers.length < initialLength;
    }

    /**
     * Get all languages for a user
     */
    static getUserLanguages(config: BotConfig, userId: string): string[] {
        return config.autotranslateUsers
            .filter(u => u.userId === userId)
            .map(u => u.language);
    }

    /**
     * Get all autotranslate users
     */
    static getAllUsers(config: BotConfig): AutotranslateUser[] {
        return config.autotranslateUsers;
    }
}
