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
}

export interface MessageBuffer {
    messages: { role: string; content: string }[];
    lastMessageTimestamp: number;
    responseTimer: NodeJS.Timeout | null;
}

export interface MessageLog {
    messages: { role: string; content: string }[];
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
        useVoiceResponse: false
    };

    constructor() {
        // Load persisted data on startup
        this.loadPersistedData();
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

            const data = {
                config,
                messages: log.messages,
                customPrompt,
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
}