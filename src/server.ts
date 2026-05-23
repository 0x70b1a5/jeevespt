import { ChannelType, Client, GatewayIntentBits, Message, Partials, TextChannel } from 'discord.js';
import { BotState, ScheduledReminder, ScheduledTask } from './bot';
import { CommandHandler } from './commands';
import { discordTimestamp } from './commands/utils';
import { computeNextRun } from './commands/tasks';
import { MAX_TASK_FAILURES, SYS_PREFIX } from './commands/constants';
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
            this.checkReminders();
            this.checkTasks();
            this.checkLearningQuestions();
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

        // Disabled: online/offline messages
        // console.log('👋 Sending farewell messages...');
        // for (const guild of this.client.guilds.cache.values()) {
        //     const channel = guild.channels.cache
        //         .find(ch =>
        //             ch.type === ChannelType.GuildText &&
        //             ch.name === process.env.TARGET_CHANNEL_NAME
        //         ) as TextChannel;
        //
        //     if (channel) {
        //         try {
        //             await channel.send('Your Jeeves is going offline, sir.');
        //         } catch (error) {
        //             console.error('Error sending offline message:', error);
        //         }
        //     }
        // }

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
        this.client.on('clientReady', async () => {
            console.log(`🎩 Logged in as ${this.client.user?.tag}`);
            // Disabled: online/offline messages
            // await this.sendWelcomeMessage();
        });

        this.client.on('messageCreate', async (message: Message) => {
            if (message.author.bot) return;

            // Check reaction mode first (this doesn't require message to be in target channel)
            if (message.guild) {
                // Check if this message should get a reaction
                await this.commands.handleReaction(message);

                // Check if this message should be auto-translated
                await this.commands.handleAutotranslate(message);
            }

            const isDM = message.channel.type === ChannelType.DM;
            const id = isDM ? message.author.id : message.guild!.id;

            // Determine if we should process this message and whether we should respond
            let shouldProcess = false;
            let shouldRespond = false;

            if (isDM) {
                // DM logic: check allowDMs config
                const config = this.state.getConfig(message.author.id, true);
                shouldProcess = config.allowDMs;
                shouldRespond = config.allowDMs;
            } else {
                // Guild channel logic
                const channelId = message.channel.id;
                const membership = this.state.getChannelMembership(id, false, channelId);

                if (membership) {
                    // Channel is explicitly configured
                    switch (membership.responseFrequency) {
                        case 'none':
                            shouldProcess = false;
                            shouldRespond = false;
                            break;
                        case 'all':
                            shouldProcess = true;
                            shouldRespond = true;
                            break;
                        case 'mentions':
                            shouldProcess = true;
                            // Check if bot is mentioned
                            shouldRespond = message.mentions.has(this.client.user!.id);
                            break;
                    }
                } else if ((message.channel as TextChannel)?.name === process.env.TARGET_CHANNEL_NAME) {
                    // Backwards compatibility: TARGET_CHANNEL_NAME behaves like EveryMessage
                    shouldProcess = true;
                    shouldRespond = true;
                }
            }

            if (!shouldProcess) {
                console.log('📝 Ignoring message from unconfigured channel', {
                    isDM: message.channel.type === ChannelType.DM,
                    channelName: (message.channel as TextChannel)?.name,
                    channelId: message.channel.id
                });
                return;
            }

            console.log(`📨 Processing message from ${message.author.tag} in ${isDM ? 'DM' : message.guild?.name} (shouldRespond: ${shouldRespond})`);

            // Handle commands or regular messages
            if (message.content.startsWith('!')) {
                await this.commands.handleCommand(message, isDM);
            } else {
                await this.commands.handleMessage(message, isDM, shouldRespond);
            }
        });

        process.on('SIGINT', () => this.handleShutdown());
    }

    private async checkReminders() {
        const now = Date.now();
        const allReminders = this.state.getAllReminders();

        for (const reminder of allReminders) {
            if (reminder.triggerTime.getTime() <= now) {
                await this.triggerReminder(reminder);
                this.state.removeReminder(reminder.id);
            }
        }
    }

    private async triggerReminder(reminder: ScheduledReminder) {
        try {
            let channel;
            const user = await this.client.users.fetch(reminder.userId);
            if (reminder.isDM) {
                channel = user.dmChannel;
            } else {
                channel = this.client.channels.cache.get(reminder.channelId);
            }

            if (!channel || !('send' in channel)) {
                console.log(`🚫 Could not find channel for reminder: ${reminder.id}`);
                return;
            }

            // Generate a custom reminder preface for the user, according to the bot's personality

            const msg =  `Hi!  It's me, ${user.tag}.  I've set an automated reminder to go off right now.  Here's the reminder: \n\n<reminder>${reminder.content}</reminder>\n\n. Can you please write me a short message so that when I see it, I remember to do the thing it's about?`

            const completion = await this.commands.generateResponse(
                reminder.userId,
                reminder.isDM,
                [{
                    role: 'user',
                    content: msg,
                }],
                2,
                true
            );

            await channel.send(
                (completion?.content ?? "") + "\n\n" +
                `⏰ **Reminder!** <@${reminder.userId}>\n` +
                `📝 ${reminder.content}\n` +
                `🕐 Set for: ${discordTimestamp(reminder.triggerTime, 'f')}`
            );

            console.log(`✅ Triggered reminder for user ${reminder.userId}: "${reminder.content}"`);
        } catch (error) {
            console.error(`❌ Error triggering reminder ${reminder.id}:`, error);
        }
    }

    private async checkTasks() {
        const now = Date.now();
        const allTasks = this.state.getAllTasks();

        for (const task of allTasks) {
            if (task.paused) continue;
            if (task.nextRun.getTime() > now) continue;
            await this.triggerTask(task);
        }
    }

    private async triggerTask(task: ScheduledTask) {
        // For task execution we need the (id, isDM) pair that the command handler uses
        // for persona lookup. DM tasks use userId; guild tasks derive the guildId from
        // the channel (we don't store guildId on the task directly).
        let stateId: string = task.userId;
        let resolvedChannel: any = null;
        try {
            if (task.isDM) {
                const user = await this.client.users.fetch(task.userId);
                resolvedChannel = await user.createDM();
                stateId = task.userId;
            } else {
                resolvedChannel = await this.client.channels.fetch(task.channelId);
                stateId = (resolvedChannel as TextChannel)?.guild?.id || task.userId;
            }
        } catch (err) {
            console.error(`❌ Could not resolve channel for task ${task.id}:`, err);
            await this.recordTaskFailure(task);
            return;
        }

        if (!resolvedChannel || !('send' in resolvedChannel)) {
            console.error(`❌ Channel for task ${task.id} is not sendable.`);
            await this.recordTaskFailure(task);
            return;
        }

        console.log(`🚀 Running task ${task.id}: "${task.instructions.slice(0, 80)}"`);

        let response;
        try {
            if ('sendTyping' in resolvedChannel) {
                try { await resolvedChannel.sendTyping(); } catch { /* non-fatal */ }
            }
            response = await this.commands.runTask(stateId, task.isDM, task.instructions);
        } catch (err) {
            console.error(`❌ Task agent threw for ${task.id}:`, err);
            await this.recordTaskFailure(task, resolvedChannel);
            return;
        }

        if (!response) {
            await this.recordTaskFailure(task, resolvedChannel);
            return;
        }

        try {
            await resolvedChannel.send(response.content);
        } catch (err) {
            console.error(`❌ Failed to send task response for ${task.id}:`, err);
            await this.recordTaskFailure(task, resolvedChannel);
            return;
        }

        await this.recordTaskSuccess(task);
    }

    private async recordTaskSuccess(task: ScheduledTask) {
        const now = new Date();
        task.lastRun = now;
        task.consecutiveFailures = 0;

        if (!task.recurrence) {
            this.state.removeTask(task.id);
            console.log(`✅ Completed one-shot task ${task.id}`);
            return;
        }

        task.nextRun = computeNextRun(task.recurrence, now);
        this.state.updateTask(task);
        console.log(`✅ Recurring task ${task.id} re-armed for ${task.nextRun.toISOString()}`);
    }

    private async recordTaskFailure(task: ScheduledTask, channel?: any) {
        task.consecutiveFailures += 1;
        task.lastRun = new Date();

        if (task.consecutiveFailures >= MAX_TASK_FAILURES) {
            task.paused = true;
            this.state.updateTask(task);
            console.warn(`⏸️ Task ${task.id} paused after ${task.consecutiveFailures} failures`);
            if (channel && 'send' in channel) {
                try {
                    await channel.send(
                        `${SYS_PREFIX}⏸️ Task paused after ${task.consecutiveFailures} consecutive failures.\n` +
                        `📝 ${task.instructions}\n` +
                        `🆔 \`${task.id}\`\n` +
                        `Use \`!canceltask ${task.id}\` to remove it, or recreate it with \`!task\`.`
                    );
                } catch { /* best effort */ }
            }
            return;
        }

        // Re-arm: recurring → next scheduled slot; one-shot → retry in 5 min.
        if (task.recurrence) {
            task.nextRun = computeNextRun(task.recurrence, new Date());
        } else {
            task.nextRun = new Date(Date.now() + 5 * 60 * 1000);
        }
        this.state.updateTask(task);
        console.warn(`⚠️ Task ${task.id} failed (${task.consecutiveFailures}/${MAX_TASK_FAILURES}); next attempt ${task.nextRun.toISOString()}`);
    }

    private async checkLearningQuestions() {
        // Check guilds for learning questions
        this.client.guilds.cache.forEach(async guild => {
            const config = this.state.getConfig(guild.id, false);
            if (!config.learningEnabled || config.learningSubjects.length === 0) return;

            const nextSubject = this.state.getNextQuestionSubject(guild.id, false, config.learningSubjects);
            if (nextSubject) {
                await this.performLearningQuestion(guild.id, false, nextSubject);
            }
        });

        // Check DMs for learning questions
        this.client.users.cache.forEach(async user => {
            const config = this.state.getConfig(user.id, true);
            if (!config.learningEnabled || !config.allowDMs || config.learningSubjects.length === 0) return;

            const nextSubject = this.state.getNextQuestionSubject(user.id, true, config.learningSubjects);
            if (nextSubject) {
                await this.performLearningQuestion(user.id, true, nextSubject);
            }
        });
    }

    private async performLearningQuestion(id: string, isDM: boolean, subject: string) {
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
            console.log(`🚫 Could not find valid channel for learning question (${isDM ? 'DM' : 'guild'}: ${id})`);
            return;
        }

        try {
            await channel.sendTyping();

            // Generate a learning question using the commands module
            await this.commands.performLearningQuestion(channel, id, isDM, subject);

            // Record that we asked a question for this subject
            this.state.recordQuestionAsked(id, isDM, subject);
        } catch (error) {
            console.error('Error performing learning question:', error);
        }
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