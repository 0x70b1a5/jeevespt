/**
 * Command Handler - Main entry point for the refactored command system
 *
 * This module provides backwards-compatible API while using the new
 * command registry pattern internally.
 */

import { Attachment, Message, TextChannel, DMChannel, TextBasedChannel, ChatInputCommandInteraction } from 'discord.js';
import { MessageParam } from '@anthropic-ai/sdk/resources';
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';

import { BotState } from '../bot';
import { ElevenLabs } from '../elevenlabs';
import { synthesizeIPA } from '../ipaSpeech';
import { JEEVES_PROMPT, TOKIPONA_PROMPT } from '../prompts/prompts';
import { prependTimestampAndUsername, extractEmbedDataToText } from '../formatMessage';
import whisper from '../whisper';

import { CommandContext, CommandDependencies, GeneratedResponse } from './types';
import { CommandRegistry, registry } from './registry';
import { commandUtils, CommandUtilsImpl, canExecuteCommand, isSendableChannel } from './utils';
import {
    SYS_PREFIX, MAX_RETRIES, RETRY_DELAY_MS,
    ALLOWED_DOMAINS, TEMP_DIR, TASK_AGENT_WEB_SEARCH_MAX_USES,
    modelSupportsTemperature
} from './constants';

// Import command modules
import { configCommands } from './config';
import { modeCommands } from './modes';
import { museCommands, MuseHandler, museCommand } from './muse';
import { reminderCommands } from './reminders';
import { taskCommands } from './tasks';
import { learningCommands, performLearningQuestion, learnCommand } from './learning';
import { interactionToArgs, createInteractionMessage } from './slash';
import { reactionCommands, handleReaction } from './reactions';
import { translateCommands, handleAutotranslate } from './translate';
import { channelConfigCommands } from './channel-config';
import { adminCommands } from './admin';
import { patreonCommands } from './patreon';
import { transcribeCommands } from './transcribe';
import { sitelenCommands } from './sitelen';

import fs from 'fs';
import https from 'https';
import path from 'path';
import { URL } from 'url';
import { promisify } from 'util';
import { LUGSO_NONTHINKING_PROMPT, LUGSO_PROMPT, LUGSO_THINKING_PROMPT } from '../prompts/lugso';
const pipeline = promisify(require('stream').pipeline);

/**
 * CommandHandler - Backwards-compatible class that uses the new registry
 */
export class CommandHandler {
    private deps: CommandDependencies;
    private utils: CommandUtilsImpl;
    private museHandler: MuseHandler;

    constructor(
        private state: BotState,
        private openai: OpenAI,
        private anthropic: Anthropic,
        private elevenLabs: ElevenLabs
    ) {
        this.deps = { state, openai, anthropic, elevenLabs };
        this.utils = new CommandUtilsImpl();

        // Initialize muse handler with generateResponse bound to this instance
        this.museHandler = new MuseHandler(
            this.generateResponse.bind(this),
            this.deps
        );

        // Register all commands
        this.registerCommands();
    }

    private registerCommands(): void {
        registry.registerAll([
            ...configCommands,
            ...modeCommands,
            ...museCommands,
            // muse and learn are dispatched specially (they need handler
            // internals), but they're registered so they appear in !help, get
            // registered as slash commands, and can be whitelisted.
            museCommand,
            learnCommand,
            ...reminderCommands,
            ...taskCommands,
            ...learningCommands,
            ...reactionCommands,
            ...translateCommands,
            ...channelConfigCommands,
            ...adminCommands,
            ...patreonCommands,
            ...transcribeCommands,
            ...sitelenCommands
        ]);
    }

    /**
     * Handle a command message
     */
    async handleCommand(message: Message, isDM: boolean): Promise<void> {
        const [command, ...args] = message.content.slice(1).split(' ');
        const commandName = command.toLowerCase();
        console.log(`🎮 Handling command: ${commandName} from ${isDM ? 'DM' : 'guild'} (${message.author.tag})`);

        const id = isDM ? message.author.id : message.guild!.id;
        const ctx: CommandContext = { message, id, isDM, args };

        // Handle special commands that need direct access to this class
        if (commandName === 'muse') {
            // Check admin mode permissions for special commands
            const config = this.state.getConfig(id, isDM);
            const permCheck = canExecuteCommand(message, commandName, config);
            if (!permCheck.allowed) {
                await message.reply(`${SYS_PREFIX}${permCheck.reason}`);
                return;
            }
            await this.museHandler.muse(message, id, isDM, args[0], true);
            return;
        }

        if (commandName === 'learn') {
            // Check admin mode permissions for special commands
            const config = this.state.getConfig(id, isDM);
            const permCheck = canExecuteCommand(message, commandName, config);
            if (!permCheck.allowed) {
                await message.reply(`${SYS_PREFIX}${permCheck.reason}`);
                return;
            }
            await this.triggerLearningQuestion(message, id, isDM);
            return;
        }

        // Use registry for all other commands
        await registry.execute(commandName, ctx, this.deps);
    }

    /**
     * Handle a Discord slash-command interaction.
     *
     * Slash commands and the legacy `!` text path share one registry and the
     * same handlers. This adapts the interaction into the CommandContext those
     * handlers expect (see commands/slash.ts) and mirrors handleCommand's
     * muse/learn special-casing. The `!` path is untouched, so voice commands
     * keep working.
     */
    async handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
        const commandName = interaction.commandName.toLowerCase();
        const isDM = !interaction.guild;
        const id = isDM ? interaction.user.id : interaction.guild!.id;
        console.log(`🔌 Handling slash command: ${commandName} from ${isDM ? 'DM' : 'guild'} (${interaction.user.tag})`);

        const command = registry.get(commandName);
        // Config/toggle/mode confirmations reply ephemerally so they don't
        // clutter the channel (slash only — the !text path can't be ephemeral).
        const ephemeral = !!command?.ephemeral;

        // Defer up front for slow commands so we never miss Discord's 3s ack deadline.
        if (command?.deferred) {
            try {
                await interaction.deferReply({ ephemeral });
            } catch (error) {
                console.error('Failed to defer reply:', error);
            }
        }

        const tracker = { consumed: false };
        const args = command ? interactionToArgs(command, interaction) : [];
        const reconstructed = `!${commandName}${args.length ? ' ' + args.join(' ') : ''}`;
        const message = createInteractionMessage(interaction, tracker, reconstructed, ephemeral);
        const ctx: CommandContext = { message, id, isDM, args };

        try {
            // muse and learn need handler internals (generateResponse), so they
            // bypass the registry here exactly as they do in handleCommand.
            if (commandName === 'muse' || commandName === 'learn') {
                const config = this.state.getConfig(id, isDM);
                const permCheck = canExecuteCommand(message, commandName, config);
                if (!permCheck.allowed) {
                    await message.reply(`${SYS_PREFIX}${permCheck.reason}`);
                } else if (commandName === 'muse') {
                    await this.museHandler.muse(message, id, isDM, args[0], true);
                } else {
                    await this.triggerLearningQuestion(message, id, isDM);
                }
            } else {
                await registry.execute(commandName, ctx, this.deps);
            }
        } catch (error) {
            console.error(`❌ Error handling slash command ${commandName}:`, error);
            try {
                await message.reply(`${SYS_PREFIX}[ERROR] Something went wrong running that command.`);
            } catch { /* best effort */ }
        } finally {
            // If the command produced all its output through the channel/webhook
            // (e.g. muse) and never replied, clear the lingering deferred reply.
            if (!tracker.consumed) {
                try {
                    if (interaction.deferred) {
                        await interaction.deleteReply();
                    } else {
                        await interaction.reply({ content: '✓ Done, sir.', ephemeral: true });
                    }
                } catch { /* best effort */ }
            }
        }
    }

    /**
     * Handle a regular message (not a command)
     */
    async handleMessage(message: Message, isDM: boolean, shouldRespond: boolean = true): Promise<void> {
        console.log(`📨 Processing message from ${isDM ? 'DM' : 'guild'} (${message.author.tag}), shouldRespond: ${shouldRespond}`);
        const id = isDM ? message.author.id : message.guild!.id;
        const buffer = this.state.getBuffer(id, isDM);
        const log = this.state.getLog(id, isDM);
        const config = this.state.getConfig(id, isDM);

        let userMessage = prependTimestampAndUsername(message);

        // Handle audio attachments if present
        let audio: Attachment | undefined;
        for (const [messageID, attachment] of message.attachments) {
            if (attachment.name.match(/\.(mp3|ogg|wav|m4a|aac|flac|webm)$/i)) {
                audio = attachment;
                break;
            } else if (this.utils.isTextFileAttachment(attachment)) {
                console.log(`🔍 Processing text file: ${attachment.name} (${attachment.contentType})`);
                const content = await this.utils.downloadAndReadTextFile(attachment.url, `text_${message.author.id}_${Date.now()}.txt`);
                userMessage += `\n[SYSTEM] The user attached a text file (${attachment.name}). Here is the content: \n\n ${content}`;
            }
        }

        if (audio) {
            userMessage = await this.transcribeAudio(audio, message, id, isDM) || userMessage;
            const firstWord = userMessage.split(' ')[0];
            const secondWord = userMessage.split(' ')[1]?.replace(/[^a-zA-Z0-9]/g, '') || '';
            const rest = userMessage.slice(userMessage.indexOf(secondWord) + secondWord.length).trim();

            if (firstWord.toLowerCase().startsWith('command')) {
                try {
                    await message.reply(`${SYS_PREFIX}Detected voice command: \`${secondWord}\`.`);
                    message.content = `!${secondWord.trim().replace('!', '')} ${rest}`.toLowerCase();
                    return this.handleCommand(message, isDM);
                } catch (error) {
                    console.error('Error processing voice command:', error);
                }
            }
        }

        // Handle whisper mode
        if (config.mode === 'whisper') {
            if (!message.attachments.size) {
                await message.reply(SYS_PREFIX + 'Please send an audio message to receive a transcription, or switch modes (!help) to chat with a persona.');
            }
            return;
        }

        userMessage += extractEmbedDataToText(message);

        // Add message to both buffer and log
        const formattedMessage = {
            role: 'user',
            content: userMessage
        };

        buffer.messages.push(formattedMessage);
        log.messages.push(formattedMessage);

        // Trim log if needed
        if (log.messages.length > config.messageLimit) {
            log.messages = log.messages.slice(-config.messageLimit);
        }

        // Clear existing timer if any
        if (buffer.responseTimer) {
            clearTimeout(buffer.responseTimer);
        }

        // Only set a response timer if we should respond
        if (shouldRespond) {
            const hasUrls = this.utils.hasURLs(message.content);
            const isCommand = message.content.startsWith('!');

            const delay = isCommand
                ? 0
                : hasUrls
                    ? Math.max(config.responseDelayMs, 5000)
                    : config.responseDelayMs;

            buffer.responseTimer = setTimeout(
                () => this.sendDelayedResponse(message, isDM),
                delay
            );
        }
    }

    /**
     * Generate AI response
     */
    async generateResponse(
        id: string,
        isDM: boolean,
        additionalMessages: { role: string; content: string }[] = [],
        retryCount = 0,
        isReminder = false
    ): Promise<GeneratedResponse | null> {
        console.log(`🤖 Generating AI response for ${isDM ? 'user' : 'guild'}: ${id}${retryCount > 0 ? ` (Attempt ${retryCount + 1}/${MAX_RETRIES + 1})` : ''}`);

        const buffer = this.state.getBuffer(id, isDM);
        const log = this.state.getLog(id, isDM);
        const config = this.state.getConfig(id, isDM);
        const systemPrompt = this.getSystemPrompt(id, isDM);

        const recentLogMessages = log.messages
            .slice(-config.messageLimit)
            .filter(logMsg =>
                !buffer.messages.some(bufMsg =>
                    bufMsg.content === logMsg.content
                )
            );

        const latestMessages = [
            ...recentLogMessages,
            ...buffer.messages,
            ...additionalMessages
        ].filter(Boolean);

        console.log(`📚 Context size: ${latestMessages.length} messages (${recentLogMessages.length} from log, ${buffer.messages.length} from buffer)`);

        try {
            let enhancedSystemPrompt = systemPrompt?.content || '';
            const isShortResponse = config.maxResponseLength <= 300;

            if (isShortResponse) {
                const lengthGuidance = `\n\nIMPORTANT: You have a strict limit of ${config.maxResponseLength} tokens for your response. Please ensure your response is complete and ends naturally within this limit. Be concise and prioritize the most essential information. Do not start sentences you cannot finish within the token limit.`;
                enhancedSystemPrompt += lengthGuidance;
            }

            if (isReminder) {
                enhancedSystemPrompt += `\n\nIMPORTANT: You are about to send a reminder to a user. You are part of a system that can set reminders; however, do not break character for this message.`;
            }

            // Build API request options
            const apiOptions: any = {
                model: config.model,
                messages: latestMessages.map(msg => ({
                    role: msg?.role === 'assistant' ? 'assistant' : 'user',
                    content: msg?.content
                })).filter(m => Boolean(m?.content)) as MessageParam[],
                max_tokens: config.maxResponseLength,
                system: enhancedSystemPrompt
            };

            // Add extended thinking if enabled (requires temperature=1)
            if (config.extendedThinking) {
                apiOptions.thinking = {
                    type: 'enabled',
                    budget_tokens: 3000
                };
                apiOptions.max_tokens = config.maxResponseLength + 3000;
                // Temperature must be 1 for extended thinking
            } else if (modelSupportsTemperature(config.model)) {
                apiOptions.temperature = config.temperature;
            }

            // Grant the model the server-side web search tool when enabled.
            // This is a "server tool" — Anthropic executes the search and
            // returns results inline, so no client-side tool loop is needed.
            if (config.webSearchEnabled) {
                apiOptions.tools = [
                    ...(apiOptions.tools ?? []),
                    {
                        type: 'web_search_20250305',
                        name: 'web_search',
                        max_uses: config.webSearchMaxUses
                    }
                ];
            }

            const completion = await this.anthropic.messages.create(apiOptions);

            // With web search, the response may contain multiple text blocks
            // interleaved with server_tool_use / web_search_tool_result blocks.
            // Concatenate every text block, and append a Sources list from any
            // web_search citations the model attached.
            const blocks = completion.content as any[];
            const textParts: string[] = [];
            const sources = new Map<string, string>(); // url -> title
            let searchesPerformed = 0;

            for (const block of blocks) {
                if (block.type === 'text') {
                    textParts.push(block.text);
                    if (Array.isArray(block.citations)) {
                        for (const citation of block.citations) {
                            if (citation.type === 'web_search_result_location' && citation.url) {
                                sources.set(citation.url, citation.title || citation.url);
                            }
                        }
                    }
                } else if (block.type === 'server_tool_use' && block.name === 'web_search') {
                    searchesPerformed++;
                }
            }

            const text = textParts.join('\n\n').trim();
            if (text) {
                let finalContent = text;
                if (sources.size > 0) {
                    const sourceLines = Array.from(sources.entries())
                        .map(([url, title]) => `- [${title}](${url})`)
                        .join('\n');
                    finalContent += `\n\n**Sources:**\n${sourceLines}`;
                }
                const response = { role: 'assistant', content: finalContent };
                const meta: string[] = [];
                if (config.extendedThinking) meta.push('thinking');
                if (searchesPerformed > 0) meta.push(`${searchesPerformed} web search${searchesPerformed === 1 ? '' : 'es'}`);
                const metaStr = meta.length ? ` [${meta.join(', ')}]` : '';
                console.log(`✅ Generated response (${response.content.length} chars)${metaStr}`);
                return response;
            }
            return null;
        } catch (error: any) {
            if (
                error.headers?.['x-should-retry'] === 'true' &&
                retryCount < MAX_RETRIES
            ) {
                const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
                console.log(`⏳ Request failed, retrying in ${delay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);

                await new Promise(resolve => setTimeout(resolve, delay));
                return this.generateResponse(id, isDM, additionalMessages, retryCount + 1);
            }

            console.error('❌ Error generating response:', error);
            throw error;
        }
    }

    /**
     * Run a scheduled task as a one-shot agent.
     *
     * Uses the channel's persona system prompt (so output stays in character)
     * but deliberately does NOT include chat history or buffer — the agent
     * gets a clean slate with just the task instructions. Web search is
     * forced on regardless of channel config, since tasks almost always
     * need fresh info.
     *
     * Throws on API failure so the caller can implement retry / pause logic.
     */
    async runTask(id: string, isDM: boolean, instructions: string): Promise<GeneratedResponse | null> {
        const config = this.state.getConfig(id, isDM);
        const systemPrompt = this.getSystemPrompt(id, isDM);

        const taskFraming = `[SYSTEM] You are being invoked as a scheduled task. The user set this task in advance; they are not present to clarify. Carry out the following task and respond with your findings, in character. Do not break character to discuss the task framing.\n\n<task>\n${instructions}\n</task>`;

        const apiOptions: any = {
            model: config.model,
            messages: [{ role: 'user', content: taskFraming }],
            max_tokens: config.maxResponseLength,
            system: systemPrompt?.content || '',
            tools: [{
                type: 'web_search_20250305',
                name: 'web_search',
                max_uses: TASK_AGENT_WEB_SEARCH_MAX_USES
            }]
        };
        if (modelSupportsTemperature(config.model)) {
            apiOptions.temperature = config.temperature;
        }

        const completion = await this.anthropic.messages.create(apiOptions);

        const blocks = completion.content as any[];
        const textParts: string[] = [];
        const sources = new Map<string, string>();
        for (const block of blocks) {
            if (block.type === 'text') {
                textParts.push(block.text);
                if (Array.isArray(block.citations)) {
                    for (const citation of block.citations) {
                        if (citation.type === 'web_search_result_location' && citation.url) {
                            sources.set(citation.url, citation.title || citation.url);
                        }
                    }
                }
            }
        }

        const text = textParts.join('\n\n').trim();
        if (!text) return null;

        let finalContent = text;
        if (sources.size > 0) {
            const sourceLines = Array.from(sources.entries())
                .map(([url, title]) => `- [${title}](${url})`)
                .join('\n');
            finalContent += `\n\n**Sources:**\n${sourceLines}`;
        }
        return { role: 'assistant', content: finalContent };
    }

    /**
     * Get system prompt for current mode
     */
    getSystemPrompt(id: string, isDM: boolean): { role: string; content: string } | null {
        const config = this.state.getConfig(id, isDM);

        switch (config.mode) {
            case 'tokipona':
                return { role: 'system', content: TOKIPONA_PROMPT };
            case 'whisper':
                return null;
            case 'customprompt':
                return { role: 'system', content: this.state.getCustomPrompt(id, isDM) };
            case 'lugso':
                return {
                    role: 'system',
                    content: LUGSO_PROMPT + (config.extendedThinking ? LUGSO_THINKING_PROMPT : LUGSO_NONTHINKING_PROMPT)
                };
            case 'jeeves':
            default:
                return { role: 'system', content: JEEVES_PROMPT };
        }
    }

    /**
     * Muse - public method for server.ts compatibility
     */
    async muse(message: Message, id: string, isDM: boolean, url?: string, museWasRequested = false): Promise<void> {
        return this.museHandler.muse(message, id, isDM, url, museWasRequested);
    }

    /**
     * Handle reaction - delegate to reactions module
     */
    async handleReaction(message: Message): Promise<void> {
        return handleReaction(message, this.deps);
    }

    /**
     * Handle autotranslate - delegate to translate module
     */
    async handleAutotranslate(message: Message): Promise<void> {
        return handleAutotranslate(message, this.deps);
    }

    /**
     * Perform learning question - public for server.ts
     */
    async performLearningQuestion(channel: TextChannel | DMChannel, id: string, isDM: boolean, subject: string): Promise<void> {
        return performLearningQuestion(channel, id, isDM, subject, this.deps);
    }

    // Private helper methods

    private async sendDelayedResponse(message: Message, isDM: boolean): Promise<void> {
        const id = isDM ? message.author.id : message.guild!.id;
        const buffer = this.state.getBuffer(id, isDM);
        const log = this.state.getLog(id, isDM);
        const config = this.state.getConfig(id, isDM);
        const channel = message.channel;

        if (!isSendableChannel(channel)) {
            console.error('Channel does not support sending messages');
            return;
        }

        try {
            await channel.sendTyping();
            const response = await this.generateResponse(id, isDM);

            if (response) {
                const chunks = this.utils.splitMessageIntoChunks(
                    [response],
                    { maxChunkSize: 1800, spoiler: config.useVoiceResponse }
                );

                if (config.useVoiceResponse) {
                    await channel.sendTyping();
                    let audioFile: string | null = null;

                    // Try to synthesize voice, but don't block message send on failure
                    try {
                        audioFile = (config.mode === 'tokipona' || config.mode === 'lugso')
                            ? await synthesizeIPA(response.content, message.author.id, config.mode)
                            : await this.elevenLabs.synthesizeSpeech(response.content, message.author.id);
                    } catch (error) {
                        console.error('Error synthesizing voice:', error);
                    }

                    // Send the text message (with audio if synthesis succeeded)
                    for (let i = 0; i < chunks.length; i++) {
                        const chunk = chunks[i];
                        if (!chunk) continue;
                        if (i === 0 && audioFile) {
                            await this.utils.sendWebhookMessage(
                                message.channel,
                                chunk,
                                config.mode,
                                [{
                                    attachment: audioFile,
                                    name: 'response.mp3'
                                }]
                            );
                        } else {
                            await this.utils.sendWebhookMessage(message.channel, chunk, config.mode);
                        }
                    }

                    // Clean up audio file if created, otherwise notify about synthesis failure
                    if (audioFile) {
                        fs.unlinkSync(audioFile);
                    } else {
                        await message.reply(`${SYS_PREFIX}[ERROR] Could not generate voice response.`);
                    }
                } else {
                    for (const chunk of chunks) {
                        if (chunk) {
                            await this.utils.sendWebhookMessage(message.channel, chunk, config.mode);
                        }
                    }
                }

                log.messages.push(response);
            }
        } catch (error) {
            console.error('Error sending delayed response:', error);
            await message.reply(`${SYS_PREFIX}[ERROR] Failed to generate response.`);
        }

        buffer.messages = [];
        buffer.responseTimer = null;
    }

    private async triggerLearningQuestion(message: Message, id: string, isDM: boolean): Promise<void> {
        const config = this.state.getConfig(id, isDM);

        if (!config.learningEnabled) {
            await message.reply(`${SYS_PREFIX}Learning questions are disabled. Use \`!learnon\` to enable them.`);
            return;
        }

        if (config.learningSubjects.length === 0) {
            await message.reply(`${SYS_PREFIX}No learning subjects configured. Use \`!learnadd <subject>\` to add subjects.`);
            return;
        }

        let subject = this.state.getNextQuestionSubject(id, isDM, config.learningSubjects);
        if (!subject) {
            subject = config.learningSubjects[Math.floor(Math.random() * config.learningSubjects.length)];
        }

        this.state.recordQuestionAsked(id, isDM, subject);
        await this.performLearningQuestion(message.channel as any, id, isDM, subject);
    }

    // File handling methods

    private sanitizeFilename(filename: string): string {
        return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    }

    private createTempFilename(filename: string): string {
        return path.join(TEMP_DIR, this.sanitizeFilename(filename));
    }

    private async downloadFile(url: string, filename: string, destination: string): Promise<void> {
        try {
            console.log(`🔍 Downloading file from ${url} to ${filename}`);

            let parsedUrl: URL;
            try {
                parsedUrl = new URL(url);
            } catch (error) {
                throw new Error('Invalid URL provided');
            }

            if (!ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
                throw new Error(`Domain not allowed: ${parsedUrl.hostname}`);
            }

            if (parsedUrl.protocol !== 'https:') {
                throw new Error('Only HTTPS URLs are allowed');
            }

            const response = await new Promise<any>((resolve, reject) => {
                const req = https.get(url, (res) => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Failed to download: ${res.statusCode} ${res.statusMessage}`));
                        return;
                    }
                    resolve(res);
                }).on('error', reject);

                req.setTimeout(30000, () => {
                    req.destroy();
                    reject(new Error('Download timeout'));
                });
            });

            await pipeline(response, fs.createWriteStream(destination));
            console.log(`🔍 Downloaded file from ${url} to ${destination}`);
        } catch (error) {
            console.error(`❌ Error downloading file ${filename}:`, error);
            throw error;
        }
    }

    private async downloadAndReadFile(url: string, filename: string): Promise<string> {
        const safePath = this.createTempFilename(filename);
        await this.downloadFile(url, filename, safePath);
        const content = fs.readFileSync(safePath, 'utf8');
        console.log(`🔍 Read file from ${safePath}: ${content.slice(0, 100)}...`);
        fs.unlinkSync(safePath);
        return content;
    }

    private async transcribeAudio(attachment: Attachment, message: Message, id: string, isDM: boolean): Promise<string> {
        const timestamp = Date.now();
        const userId = message.author.id;
        const filename = `audio_${userId}_${timestamp}.mp3`;
        const safePath = this.createTempFilename(filename);
        const config = this.state.getConfig(id, isDM);
        const speedScalar = config.transcriptionSpeedScalar;

        console.log(`🎙️ Processing audio from ${message.author.tag} (${filename}) with speed scalar ${speedScalar}`);

        const channel = message.channel;
        if (isSendableChannel(channel)) {
            await channel.sendTyping();
        }

        try {
            await this.downloadFile(attachment.proxyURL, filename, safePath);
            console.log(`📥 Downloaded audio file from ${attachment.proxyURL} to ${safePath}`);

            const result = await whisper(this.openai, safePath, speedScalar);

            if (result.error) {
                console.error(`❌ Transcription error: ${result.error}`);
                await message.reply(SYS_PREFIX + `[ERROR] ${result.error}`);
                return '';
            }

            if (!result.text?.length) {
                await message.reply(SYS_PREFIX + '[ERROR] Could not process audio.');
                return '';
            }

            const retryInfo = result.wasRetry ? ' (succeeded on retry with 2x speed)' : '';
            const speedInfo = result.speedScalarUsed !== 1.0 ? ` at ${result.speedScalarUsed}x speed` : '';
            console.log(`✍️ Transcribed audio for ${message.author.tag}${speedInfo}${retryInfo}: "${result.text.substring(0, 100)}..."`);

            const chunks = this.utils.splitMessageIntoChunks([{ role: 'user', content: result.text }]);
            await message.reply(`${SYS_PREFIX}Transcription:`);
            for (const chunk of chunks) {
                if (chunk && isSendableChannel(channel)) await channel.send(chunk);
            }
            return result.text;
        } catch (error: any) {
            console.error(`❌ Whisper error for ${safePath}:`, error);

            let errorMsg = '[ERROR] Could not process audio.';
            if (error.message?.includes('format is not supported')) {
                errorMsg = `[ERROR] Audio format not supported. Discord sent: ${attachment.contentType || 'unknown type'}`;
            } else if (error.message?.includes('could not be decoded')) {
                errorMsg = '[ERROR] Audio file appears to be corrupted or in an unsupported encoding.';
            }

            await message.reply(SYS_PREFIX + errorMsg);
            return '';
        } finally {
            try {
                fs.unlinkSync(safePath);
                console.log(`🧹 Cleaned up audio file: ${safePath}`);
            } catch (error) {
                console.error(`Error cleaning up audio file ${safePath}:`, error);
            }
        }
    }
}

// Re-export for backwards compatibility
export { registry, CommandRegistry } from './registry';
export * from './types';
export * from './constants';
