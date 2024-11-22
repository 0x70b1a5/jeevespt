import { ChannelType, Client, GatewayIntentBits, Message, Partials, TextChannel } from 'discord.js';
import { BotState } from './new-bot';
import { CommandHandler } from './commands';
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

export class BotServer {
    private client: Client;
    private state: BotState;
    private openai: OpenAI;
    private anthropic: Anthropic;
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

        this.commands = new CommandHandler(this.state, this.openai, this.anthropic);

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
        console.log(`🎭 Performing muse for ${isDM ? 'user' : 'guild'}: ${id}`);
        const channel = isDM
            ? await this.client.users.fetch(id).then(user => user.dmChannel)
            : this.client.channels.cache
                .filter(channel =>
                    channel.type === ChannelType.GuildText &&
                    channel.guild.id === id &&
                    channel.name === process.env.TARGET_CHANNEL_NAME
                )
                .first() as TextChannel;

        if (!channel) return;

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

        // // Send to active DM channels
        // for (const [userId, config] of this.state.getAllDMConfigs()) {
        //     if (config.allowDMs) {
        //         try {
        //             const user = await this.client.users.fetch(userId);
        //             const dm = await user.createDM();
        //             await dm.send('Your Jeeves is online, sir.');
        //             console.log(`✅ Welcome message sent to user: ${user.tag} (${user.id})`);
        //         } catch (error) {
        //             console.error(`❌ Error sending welcome message to user ${userId}:`, error);
        //         }
        //     }
        // }
    }

    private initializeEventListeners() {
        this.client.on('ready', async () => {
            console.log(`🎩 Logged in as ${this.client.user?.tag}`);
            await this.sendWelcomeMessage();
        });

        this.client.on('messageCreate', async (message: Message) => {
            console.log(`📨 Processing message from ${message.author.tag} in ${message.guild?.name || 'DM'}`);
            if (message.author.bot) return;

            const isDM = !message.guild;
            const id = isDM ? message.author.id : message.guild!.id;
            const config = this.state.getConfig(id, isDM);

            const timer = this.getMuseTimer(id, isDM);
            timer.lastMessageTimestamp = Date.now();

            if (isDM && !config.allowDMs) return;

            if (message.content.startsWith('!')) {
                await this.commands.handleCommand(message, isDM);
                return;
            }

            await this.commands.handleMessage(message, isDM);
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