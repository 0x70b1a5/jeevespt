import { ChannelType, Client, GatewayIntentBits, Message, Partials, TextChannel } from 'discord.js';
import { BotState } from './bot';
import { CommandHandler } from './commands';
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { ElevenLabs } from './elevenlabs';
dotenv.config();

export class BotServer {
    private client: Client;
    private state: BotState;
    private openai: OpenAI;
    private anthropic: Anthropic;
    private elevenLabs: ElevenLabs;
    private commands: CommandHandler;
    private museTimers: Map<string, {
        timer: NodeJS.Timeout;
        lastMessageTimestamp: number;
    }> = new Map();
    constructor() {

        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages,
            ],
            partials: [
                Partials.Channel,
            ]
        });

        this.state = new BotState();

        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
        });

        this.elevenLabs = new ElevenLabs(process.env.ELEVENLABS_API_KEY);

        this.commands = new CommandHandler(this.state, this.openai, this.anthropic, this.elevenLabs);

        this.initializeEventListeners();
        this.initializeMuseTimers();
    }

    private initializeMuseTimers() {
        setInterval(() => {
            this.checkAllMuseTimers();
        }, 60000);
    }

    private async checkAllMuseTimers() {
        const now = Date.now();

        this.client.guilds.cache.forEach(guild => {
            const config = this.state.getConfig(guild.id, false);
            if (!config.shouldMuseRegularly) return;

            const timer = this.getMuseTimer(guild.id, false);
            if (now - timer.lastMessageTimestamp >= config.museInterval) {
                this.performMuse(guild.id, false);
                timer.lastMessageTimestamp = now;
            }
        });

        this.client.users.cache.forEach(user => {
            const config = this.state.getConfig(user.id, true);
            if (!config.shouldMuseRegularly || !config.allowDMs) return;

            const timer = this.getMuseTimer(user.id, true);
            if (now - timer.lastMessageTimestamp >= config.museInterval) {
                this.performMuse(user.id, true);
                timer.lastMessageTimestamp = now;
            }
        });
    }

    private getMuseTimer(id: string, isDM: boolean) {
        const key = `${isDM ? 'dm' : 'guild'}:${id}`;
        let timer = this.museTimers.get(key);

        if (!timer) {
            timer = {
                timer: null as unknown as NodeJS.Timeout,
                lastMessageTimestamp: Date.now()
            };
            this.museTimers.set(key, timer);
        }

        return timer;
    }

    private async performMuse(id: string, isDM: boolean) {
        const channel = isDM
            ? await this.client.users.fetch(id).then(user => user.dmChannel)
            : this.client.channels.cache
                .filter(channel =>
                    channel.type === ChannelType.GuildText &&
                    channel.guild.id === id &&
                    channel.name === process.env.TARGET_CHANNEL_NAME
                )
                .first() as TextChannel;

        if (!channel) {
            console.log(`🚫 Could not find valid channel for muse (${isDM ? 'DM' : 'guild'}: ${id})`);
            return;
        }

        try {
            await channel.sendTyping();
            const message = await channel.send('Contemplating the vast expanse of human knowledge...');
            await this.commands.muse(message, id, isDM);
        } catch (error) {
            console.error('Error performing muse:', error);
        }
    }

    private async handleShutdown() {
        console.log('🔄 Initiating graceful shutdown sequence...');

        // Persist data for all guilds
        for (const guild of this.client.guilds.cache.values()) {
            const config = this.state.getConfig(guild.id, false);
            if (config.shouldSaveData) {
                console.log(`💾 Persisting data for guild: ${guild.name} (${guild.id})`);
                await this.state.persistData(guild.id, false);
            }
        }

        // Persist data for all DM channels
        for (const user of this.client.users.cache.values()) {
            const config = this.state.getConfig(user.id, true);
            if (config.shouldSaveData) {
                console.log(`💾 Persisting data for user: ${user.tag} (${user.id})`);
                await this.state.persistData(user.id, true);
            }
        }

        console.log('⏲️ Clearing muse timers...');
        this.museTimers.forEach(timer => {
            if (timer.timer) clearTimeout(timer.timer);
        });

        console.log('👋 Sending farewell messages...');
        // Send offline messages
        for (const guild of this.client.guilds.cache.values()) {
            const channel = guild.channels.cache
                .find(ch =>
                    ch.type === ChannelType.GuildText &&
                    ch.name === process.env.TARGET_CHANNEL_NAME
                ) as TextChannel;

            if (channel) {
                try {
                    await channel.send('Your Jeeves is going offline, sir.');
                } catch (error) {
                    console.error('Error sending offline message:', error);
                }
            }
        }

        this.client.destroy();
        process.exit(0);
    }

    private async sendWelcomeMessage() {
        console.log('👋 Sending welcome messages...');

        // Send to guild channels
        for (const guild of this.client.guilds.cache.values()) {
            const channel = guild.channels.cache
                .find(ch =>
                    ch.type === ChannelType.GuildText &&
                    ch.name === process.env.TARGET_CHANNEL_NAME
                ) as TextChannel;

            if (channel) {
                try {
                    await channel.send('Your Jeeves is online, sir.');
                    console.log(`✅ Welcome message sent to guild: ${guild.name} (${guild.id})`);
                } catch (error) {
                    console.error(`❌ Error sending welcome message to guild ${guild.name}:`, error);
                }
            }
        }
    }

    private initializeEventListeners() {
        this.client.on('ready', async () => {
            console.log(`🎩 Logged in as ${this.client.user?.tag}`);
            await this.sendWelcomeMessage();
        });

        this.client.on('messageCreate', async (message: Message) => {
            if (message.author.bot) return;

            // Check if message is from a DM or allowed channel
            const isValidChannel =
                (message.channel.type === ChannelType.DM && this.state.getConfig(message.author.id, true).allowDMs) ||
                ((message.channel as TextChannel)?.name === process.env.TARGET_CHANNEL_NAME);

            if (!isValidChannel) {
                console.log('📝 Ignoring message from invalid channel', {
                    isDM: message.channel.type === ChannelType.DM,
                    channelName: (message.channel as TextChannel)?.name,
                    targetChannel: process.env.TARGET_CHANNEL_NAME
                });
                return;
            }

            const isDM = message.channel.type === ChannelType.DM;
            console.log(`📨 Processing message from ${message.author.tag} in ${isDM ? 'DM' : message.guild?.name}`);

            // Handle commands or regular messages
            if (message.content.startsWith('!')) {
                await this.commands.handleCommand(message, isDM);
            } else {
                await this.commands.handleMessage(message, isDM);
            }
        });

        process.on('SIGINT', () => this.handleShutdown());
    }

    public async start() {
        console.log('🚀 Starting bot...');
        try {
            await this.client.login(process.env.DISCORD_BOT_TOKEN);
        } catch (error) {
            console.error('Error starting bot:', error);
            process.exit(1);
        }
    }
}

// Start the bot
if (require.main === module) {
    const server = new BotServer();
    server.start().catch(console.error);
} 