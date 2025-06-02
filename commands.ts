import { Attachment, DMChannel, Message, TextChannel } from 'discord.js';
import { BotConfig, BotState, ReactionHistory } from './bot';
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import whisper from './whisper';
import { JEEVES_PROMPT, TOKIPONA_PROMPT, JARGONATUS_PROMPT, LEARNING_PROMPT_TEMPLATE } from './prompts';
import dayjs from 'dayjs';
import { help } from './help';
import { getWebpage } from './getWebpage';
import https from 'https';
import fs from 'fs';
import { promisify } from 'util';
import { MessageParam } from '@anthropic-ai/sdk/resources';
import { ElevenLabs } from './elevenlabs';
import path from 'path';
import { URL } from 'url';
import { extractEmbedDataToText, prependTimestampAndUsername } from './formatMessage';
const pipeline = promisify(require('stream').pipeline);

// Security constants for file downloads
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
const ALLOWED_DOMAINS = ['cdn.discordapp.com', 'media.discordapp.net']; // Only Discord CDN
const TEMP_DIR = './temp';

export class CommandHandler {
    private sysPrefix = '[SYSTEM] ';

    constructor(
        private state: BotState,
        private openai: OpenAI,
        private anthropic: Anthropic,
        private elevenLabs: ElevenLabs
    ) { }

    async handleCommand(message: Message, isDM: boolean) {
        const [command, ...args] = message.content.slice(1).split(' ');
        console.log(`🎮 Handling command: ${command} from ${isDM ? 'DM' : 'guild'} (${message.author.tag})`);
        const id = isDM ? message.author.id : message.guild!.id;

        switch (command.toLowerCase()) {
            case 'help':
                await this.showHelp(message, id, isDM);
                break;

            case 'jeeves':
            case 'tokipona':
            case 'jargon':
            case 'whisper':
                await this.setMode(message, id, isDM, command.toLowerCase());
                break;

            case 'prompt':
                await this.setCustomPrompt(message, id, isDM, args.join(' '));
                break;

            case 'clear':
                await this.clearHistory(message, id, isDM);
                break;

            case 'log':
                await this.showLog(message, id, isDM);
                break;

            case 'temperature':
                await this.setTemperature(message, id, isDM, args[0]);
                break;

            case 'model':
                await this.setModel(message, id, isDM, args[0]);
                break;

            case 'delay':
                await this.setDelay(message, id, isDM, args[0]);
                break;

            case 'tokens':
                await this.setTokens(message, id, isDM, args[0]);
                break;

            case 'limit':
                await this.setLimit(message, id, isDM, args[0]);
                break;

            case 'persist':
                await this.togglePersist(message, id, isDM);
                break;

            case 'dms':
                await this.toggleDMs(message, id, isDM);
                break;

            case 'muse':
                await this.muse(message, id, isDM, args[0], true);
                break;

            case 'museon':
                await this.toggleMuseRegularly(message, id, isDM, true);
                break;

            case 'museoff':
                await this.toggleMuseRegularly(message, id, isDM, false);
                break;

            case 'museinterval':
                await this.setMuseInterval(message, id, isDM, Number(args[0]));
                break;

            case 'voice':
                await this.toggleVoiceResponse(message, id, isDM);
                break;

            case 'reacton':
                await this.toggleReactionMode(message, id, isDM, true);
                break;

            case 'reactoff':
                await this.toggleReactionMode(message, id, isDM, false);
                break;

            case 'reactadd':
                await this.addReactionChannel(message, id, isDM, args[0]);
                break;

            case 'reactremove':
                await this.removeReactionChannel(message, id, isDM, args[0]);
                break;

            case 'remind':
                await this.addReminder(message, id, isDM, args);
                break;

            case 'reminders':
                await this.listReminders(message, id, isDM);
                break;

            case 'cancelreminder':
                await this.cancelReminder(message, id, isDM, args[0]);
                break;

            case 'learnon':
                await this.toggleLearning(message, id, isDM, true);
                break;

            case 'learnoff':
                await this.toggleLearning(message, id, isDM, false);
                break;

            case 'learnadd':
                await this.addLearningSubject(message, id, isDM, args.join(' '));
                break;

            case 'learnremove':
                await this.removeLearningSubject(message, id, isDM, args.join(' '));
                break;

            case 'learnstatus':
                await this.showLearningStatus(message, id, isDM);
                break;

            default:
                await message.reply(`${this.sysPrefix}Unrecognized command "${command}".`);
        }
    }

    private hasURLs(text: string): boolean {
        // Check for URLs in the message content
        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        return urlRegex.test(text);
    }

    async handleMessage(message: Message, isDM: boolean) {
        console.log(`📨 Processing message from ${isDM ? 'DM' : 'guild'} (${message.author.tag})`);
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
            } else if (
                attachment.size < 100000 && // 100kb
                (
                    attachment.contentType?.startsWith('text/') ||
                    attachment.contentType?.includes('xml') ||
                    attachment.contentType?.includes('svg') ||
                    attachment.name.match(/\.(txt|md|json|yaml|yml|csv|log|ts|js|py|html|css|tsx|jsx|mdx|rtf|svg|sh|bash|zsh|xml|ini|conf|cfg|env|gitignore|dockerfile)$/i)
                )
            ) {
                console.log(`🔍 Processing text file: ${attachment.name} (${attachment.contentType})`);
                const content = await this.downloadAndReadFile(attachment.url, `text_${message.author.id}_${Date.now()}.txt`);
                userMessage += `\n[SYSTEM] The user attached a text file (${attachment.name}). Here is the content: \n\n ${content}`;
            }
        }

        if (audio) {
            userMessage = await this.transcribeAudio(audio, message) || userMessage;
            const firstWord = userMessage.split(' ')[0];
            const secondWord = userMessage.split(' ')[1]?.replace(/[^a-zA-Z0-9]/g, '') || '';
            const rest = userMessage.slice(userMessage.indexOf(secondWord) + secondWord.length).trim();

            if (firstWord.toLowerCase().startsWith('command')) {
                try {
                    await message.reply(`${this.sysPrefix}Detected voice command: \`${secondWord}\`.`);
                    // Handle voice command
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
                await message.reply(this.sysPrefix + 'Please send an audio message to receive a transcription, or switch modes (!help) to chat with a persona.');
            }
            return; // transcription mode has already sent the message
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

        // Check if message contains URLs to determine if we need to wait for embeds
        const hasUrls = this.hasURLs(message.content);
        const isCommand = message.content.startsWith('!');
        
        // Use delay only if message has URLs and isn't a command
        const delay = (hasUrls && !isCommand) ? config.responseDelayMs : 0;
        
        // Set new timer for response
        buffer.responseTimer = setTimeout(
            () => this.sendDelayedResponse(message, isDM),
            delay
        );
    }

    private sanitizeFilename(filename: string): string {
        return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    }

    private createTempFilename(filename: string): string {
        return path.join(TEMP_DIR, this.sanitizeFilename(filename));
    }

    private async downloadFile(url: string, filename: string, destination: string): Promise<void> {
        try {
            console.log(`🔍 Downloading file from ${url} to ${filename}`);

            // Validate URL
            let parsedUrl: URL;
            try {
                parsedUrl = new URL(url);
            } catch (error) {
                throw new Error('Invalid URL provided');
            }

            // Check if domain is allowed (Discord CDN only)
            if (!ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
                throw new Error(`Domain not allowed: ${parsedUrl.hostname}`);
            }

            // Ensure HTTPS
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

                // Set timeout
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

    private async transcribeAudio(attachment: Attachment, message: Message): Promise<string> {
        const timestamp = Date.now();
        const userId = message.author.id;
        const filename = `audio_${userId}_${timestamp}.mp3`;
        const safePath = this.createTempFilename(filename);

        console.log(`🎙️ Processing audio from ${message.author.tag} (${filename})`);

        await message.channel.sendTyping();

        try {
            // Download the audio file with unique name
            await this.downloadFile(attachment.proxyURL, filename, safePath);
            console.log(`📥 Downloaded audio file from ${attachment.proxyURL} to ${safePath}`);

            const transcription = await whisper(this.openai, safePath);
            if (!transcription?.text?.length) {
                await message.reply(this.sysPrefix + '[ERROR] Could not process audio.');
                return '';
            }

            console.log(`✍️ Transcribed audio for ${message.author.tag}: "${transcription.text.substring(0, 100)}..."`);
            await message.reply(`${this.sysPrefix}Transcription: ${transcription.text}`);
            return transcription.text;
        } catch (error: any) {
            console.error(`❌ Whisper error for ${safePath}:`, error);

            // More specific error messages
            let errorMsg = '[ERROR] Could not process audio.';
            if (error.message?.includes('format is not supported')) {
                errorMsg = `[ERROR] Audio format not supported. Discord sent: ${attachment.contentType || 'unknown type'}`;
            } else if (error.message?.includes('could not be decoded')) {
                errorMsg = '[ERROR] Audio file appears to be corrupted or in an unsupported encoding.';
            }

            await message.reply(this.sysPrefix + errorMsg);
            return '';
        } finally {
            // Cleanup
            try {
                fs.unlinkSync(safePath);
                console.log(`🧹 Cleaned up audio file: ${safePath}`);
            } catch (error) {
                console.error(`Error cleaning up audio file ${safePath}:`, error);
            }
        }
    }

    // Individual command implementations...
    private async setMode(message: Message, id: string, isDM: boolean, mode: string) {
        this.state.getLog(id, isDM).messages = [];
        this.state.updateConfig(id, isDM, { mode: mode as any });

        const responses = {
            jeeves: 'I have switched to Jeeves mode, sir.',
            tokipona: 'mi ante e nasin tawa toki pona.',
            jargon: '`# Even in death, I serve the Omnissiah.`',
            whisper: 'Switched to transcription mode.'
        };

        await message.reply(this.sysPrefix + (responses[mode as keyof typeof responses] || 'Mode changed.'));
    }

    private async showHelp(message: Message, id: string, isDM: boolean) {
        const config = this.state.getConfig(id, isDM);
        const helpTexts = [
            `# JEEVESPT
- Remembers the last ${config.messageLimit} messages
- Temperature: ${config.temperature}
- Model: ${config.model}
- Response delay: ${config.responseDelayMs / 1000} seconds
- Muse interval: ${config.museInterval / 60 / 60 / 1000} hours
- Automatic muse: ${config.shouldMuseRegularly ? 'enabled' : 'disabled'}
- Current mode: \`${config.mode}\`
- Max response length (tokens): ${config.maxResponseLength}
- Persist data: ${config.shouldSaveData ? 'enabled' : 'disabled'}
- Direct messages: ${config.allowDMs ? 'enabled' : 'disabled'}`,
            ...help
        ];

        for (const text of helpTexts) {
            await message.channel.send(text);
        }
    }

    private async setCustomPrompt(message: Message, id: string, isDM: boolean, prompt: string) {
        const log = this.state.getLog(id, isDM);
        log.messages = [];
        this.state.updateConfig(id, isDM, { mode: 'customprompt' });
        this.state.setCustomPrompt(id, isDM, prompt);

        await message.reply(`${this.sysPrefix}Prompt set to:`);
        const chunks = this.splitMessageIntoChunks([{ role: 'user', content: prompt }]);
        for (const chunk of chunks) {
            if (chunk) await message.channel.send(chunk);
        }
    }

    private async clearHistory(message: Message, id: string, isDM: boolean) {
        const log = this.state.getLog(id, isDM);
        log.messages = [];
        await message.reply(`${this.sysPrefix}Cleared messages log.`);
    }

    private async showLog(message: Message, id: string, isDM: boolean) {
        const log = this.state.getLog(id, isDM);
        const logAsString = JSON.stringify(log.messages, null, 2);
        const chunks = this.splitMessageIntoChunks([{ role: 'assistant', content: logAsString }]);

        await message.reply(`${this.sysPrefix}CURRENT MEMORY:\n---`);
        for (const chunk of chunks) {
            if (chunk) await message.channel.send(chunk);
        }
        await message.channel.send(`${this.sysPrefix}---`);
    }

    private async setTemperature(message: Message, id: string, isDM: boolean, value: string) {
        const temp = Number(value);
        if (!isNaN(temp) && temp > 0 && temp <= 2) {
            this.state.updateConfig(id, isDM, { temperature: temp });
            await message.reply(`${this.sysPrefix}Temperature set to \`${temp}\`.`);
        } else {
            await message.reply(`${this.sysPrefix}Couldn't parse requested temperature: \`${value}\`. Must be a decimal between 0 and 2.`);
        }
    }

    private async setModel(message: Message, id: string, isDM: boolean, modelName: string) {
        if (modelName) {
            this.state.updateConfig(id, isDM, { model: modelName });
            await message.reply(`${this.sysPrefix}Model set to \`${modelName}\`.`);
        } else {
            await message.reply(`${this.sysPrefix}Couldn't parse requested model.`);
        }
    }

    private async setDelay(message: Message, id: string, isDM: boolean, value: string) {
        const delay = Math.round(Number(value));
        if (!isNaN(delay) && delay > 0) {
            this.state.updateConfig(id, isDM, { responseDelayMs: delay * 1000 });
            await message.reply(`${this.sysPrefix}Response delay set to ${delay} seconds.`);
        } else {
            await message.reply(`${this.sysPrefix}Failed to parse requested delay. Format: \`!delay SECONDS\` where SECONDS is a number greater than zero.`);
        }
    }

    private async setTokens(message: Message, id: string, isDM: boolean, value: string) {
        const tokens = Number(value);
        if (!isNaN(tokens) && tokens > 0) {
            this.state.updateConfig(id, isDM, { maxResponseLength: tokens });
            await message.reply(`${this.sysPrefix}Max response length set to ${tokens} tokens.`);
        } else {
            await message.reply(`${this.sysPrefix}Failed to parse requested tokens. Format: \`!tokens TOKENS\` where TOKENS is a number greater than zero.`);
        }
    }

    private async setLimit(message: Message, id: string, isDM: boolean, value: string) {
        const limit = Number(value);
        if (!isNaN(limit) && limit > 0) {
            this.state.updateConfig(id, isDM, { messageLimit: limit });
            await message.reply(`${this.sysPrefix}Message memory is now ${limit} messages.`);
        } else {
            await message.reply(`${this.sysPrefix}Failed to parse requested limit. Format: \`!limit X\` where X is a number greater than zero.`);
        }
    }

    private async togglePersist(message: Message, id: string, isDM: boolean) {
        const config = this.state.getConfig(id, isDM);
        const newValue = !config.shouldSaveData;
        this.state.updateConfig(id, isDM, { shouldSaveData: newValue });
        await message.reply(`${this.sysPrefix}Bot will now ${newValue ? 'SAVE' : 'NOT SAVE'} data to disk.`);
    }

    private async toggleDMs(message: Message, id: string, isDM: boolean) {
        const config = this.state.getConfig(id, isDM);
        const newValue = !config.allowDMs;
        this.state.updateConfig(id, isDM, { allowDMs: newValue });
        await message.reply(`${this.sysPrefix}Direct messages are now ${newValue ? 'ENABLED' : 'DISABLED'}.`);
    }

    private chunkOpts = {
        maxChunkSize: 1800,
        spoiler: false
    }
    private splitMessageIntoChunks(
        msgs: { role: string, content: string }[],
        opts: { maxChunkSize?: number, spoiler?: boolean } = this.chunkOpts
    ): string[] {
        const chunks: string[] = [];

        msgs.forEach(msg => {
            let content = msg.content;
            while (content.length > 0) {
                let chunk = content.slice(0, opts.maxChunkSize);
                if (opts.spoiler) {
                    chunk = `||${chunk}||`;
                }
                chunks.push(chunk);
                content = content.slice(opts.maxChunkSize);
            }
        });

        return chunks;
    }

    private async sendDelayedResponse(message: Message, isDM: boolean) {
        const id = isDM ? message.author.id : message.guild!.id;
        const buffer = this.state.getBuffer(id, isDM);
        const log = this.state.getLog(id, isDM);
        const config = this.state.getConfig(id, isDM);

        try {
            await message.channel.sendTyping();
            const response = await this.generateResponse(id, isDM);

            if (response) {
                const chunks = this.splitMessageIntoChunks(
                    [response],
                    { ...this.chunkOpts, spoiler: config.useVoiceResponse }
                );

                // If voice responses are enabled, synthesize and send audio
                if (config.useVoiceResponse) {
                    await message.channel.sendTyping();
                    try {
                        const audioFile = await this.elevenLabs.synthesizeSpeech(
                            response.content,
                            message.author.id
                        );
                        for (let i = 0; i < chunks.length; i++) {
                            const chunk = chunks[i];
                            if (!chunk) continue;
                            if (i === 0) {
                                await message.reply({
                                    content: chunk,
                                    files: [{
                                        attachment: audioFile,
                                        name: 'response.mp3'
                                    }]
                                });
                            } else {
                                await message.reply(chunk);
                            }
                        }
                        // Cleanup audio file
                        fs.unlinkSync(audioFile);
                    } catch (error) {
                        console.error('Error sending voice response:', error);
                        await message.reply(`${this.sysPrefix}[ERROR] Could not generate voice response.`);
                    }
                } else {
                    for (const chunk of chunks) {
                        if (chunk) await message.reply(chunk);
                    }
                }

                // Add response to log
                log.messages.push(response);
            }
        } catch (error) {
            console.error('Error sending delayed response:', error);
            await message.reply(`${this.sysPrefix}[ERROR] Failed to generate response.`);
        }

        // Clear buffer after response
        buffer.messages = [];
        buffer.responseTimer = null;
    }

    async generateResponse(
        id: string,
        isDM: boolean,
        additionalMessages: { role: string, content: string }[] = [],
        retryCount = 0
    ): Promise<{ role: string, content: string } | null> {
        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 1000; // Start with 1 second delay

        console.log(`🤖 Generating AI response for ${isDM ? 'user' : 'guild'}: ${id}${retryCount > 0 ? ` (Attempt ${retryCount + 1}/${MAX_RETRIES + 1})` : ''}`);
        const buffer = this.state.getBuffer(id, isDM);
        const log = this.state.getLog(id, isDM);
        const config = this.state.getConfig(id, isDM);

        const systemPrompt = this.getSystemPrompt(id, isDM);

        // Get the most recent messages from the log, excluding the current buffer
        const recentLogMessages = log.messages
            .slice(-config.messageLimit)
            .filter(logMsg =>
                !buffer.messages.some(bufMsg =>
                    bufMsg.content === logMsg.content
                )
            );

        const latestMessages = [
            ...recentLogMessages,  // Recent history from log
            ...buffer.messages,    // Current burst of messages
            ...additionalMessages  // Any additional context
        ].filter(Boolean);

        console.log(`📚 Context size: ${latestMessages.length} messages (${recentLogMessages.length} from log, ${buffer.messages.length} from buffer)`);

        try {
            const completion = await this.anthropic.messages.create({
                model: config.model,
                messages: latestMessages.map(msg => ({
                    role: msg?.role === 'assistant' ? 'assistant' : 'user',
                    content: msg?.content
                })).filter(m => Boolean(m?.content)) as MessageParam[],
                temperature: config.temperature,
                max_tokens: config.maxResponseLength,
                system: systemPrompt?.content || ''
            });

            const botMsg = completion.content[0];
            if (botMsg?.type === 'text') {
                const response = { role: 'assistant', content: botMsg.text };
                console.log(`✅ Generated response (${response.content.length} chars)`);
                return response;
            }
            return null;
        } catch (error: any) {
            // Check if we should retry
            if (
                error.headers?.['x-should-retry'] === 'true' &&
                retryCount < MAX_RETRIES
            ) {
                const delay = RETRY_DELAY_MS * Math.pow(2, retryCount); // Exponential backoff
                console.log(`⏳ Request failed, retrying in ${delay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);

                await new Promise(resolve => setTimeout(resolve, delay));
                return this.generateResponse(id, isDM, additionalMessages, retryCount + 1);
            }

            // If we've exhausted retries or shouldn't retry, throw the error
            console.error('❌ Error generating response:', error);
            throw error;
        }
    }

    getSystemPrompt(id: string, isDM: boolean): { role: string, content: string } | null {
        const config = this.state.getConfig(id, isDM);

        switch (config.mode) {
            case 'tokipona':
                return { role: 'system', content: TOKIPONA_PROMPT };
            case 'jargon':
                return { role: 'system', content: JARGONATUS_PROMPT };
            case 'whisper':
                return null;
            case 'customprompt':
                return { role: 'system', content: this.state.getCustomPrompt(id, isDM) };
            case 'jeeves':
            default:
                return { role: 'system', content: JEEVES_PROMPT };
        }
    }

    async muse(message: Message, id: string, isDM: boolean, url?: string, museWasRequested = false) {
        console.log(`🎯 Initiating muse for ${isDM ? 'user' : 'guild'}: ${id}${url ? ` with URL: ${url}` : ''}`);
        await message.channel.sendTyping();

        let pageText = '';
        try {
            if (url) {
                pageText = await getWebpage(url);
            } else {
                const wikipage = await this.getRandomWikipediaPage();
                pageText = wikipage.extract;
                url = wikipage.content_urls?.desktop?.page;
            }
        } catch (error) {
            console.error('Error fetching webpage:', error);
            await message.reply(`${this.sysPrefix}Error fetching webpage (${url || 'random'}): ${error}`);
            return;
        }

        const prompt = {
            role: 'system',
            content: `
${museWasRequested ? '' : 'It\'s been a while since the last message. It\'s up to you to inject some activity into the situation! '}

Please read the following webpage.

=== BEGIN WEBPAGE ===
${pageText}
=== END WEBPAGE ===

Please consider the implications of this webpage, which may be relevant to recent discussions. Read it carefully, and bring some insight to the discussion. Try to extract something new. Don't just summarize it! We want to engage in a way that is interesting to the audience. Be creative, think step by step, and wow the audience with your ability to synthesize pithy witticisms from many domains of knowledge.

Respond in at most 280 characters - this is a chatroom, not a blog post.

And remember, you are in ${this.state.getConfig(id, isDM).mode} mode. Please conform to the instructions, it's very important! :)

If there was an error fetching the webpage, please mention this, as the developer will want to fix his code.`
        };

        const response = await this.generateResponse(id, isDM, [prompt]);
        if (response) {
            const chunks = this.splitMessageIntoChunks([response]);
            for (const chunk of chunks) {
                if (chunk) await message.reply(chunk);
            }
            if (url) {
                await message.channel.send(url);
            }
        }
    }

    private async getRandomWikipediaPage() {
        const response = await fetch('https://en.wikipedia.org/api/rest_v1/page/random/summary');
        const data = await response.json();
        return data;
    }

    async setMuseInterval(message: Message, id: string, isDM: boolean, hours: number) {
        if (!isNaN(hours) && hours > 0) {
            this.state.updateConfig(id, isDM, { museInterval: hours * 60 * 60 * 1000 });
            await message.reply(`${this.sysPrefix}Muse interval set to ${hours} hours.`);
        } else {
            await message.reply(`${this.sysPrefix}Failed to parse muse interval. Please provide a positive number of hours.`);
        }
    }

    async toggleMuseRegularly(message: Message, id: string, isDM: boolean, enable: boolean) {
        this.state.updateConfig(id, isDM, { shouldMuseRegularly: enable });
        await message.reply(
            `${this.sysPrefix}Muse will ${enable ? 'now' : 'no longer'} happen automatically.`
        );
    }

    private async toggleVoiceResponse(message: Message, id: string, isDM: boolean) {
        const config = this.state.getConfig(id, isDM);
        const newValue = !config.useVoiceResponse;
        this.state.updateConfig(id, isDM, { useVoiceResponse: newValue });
        await message.reply(
            `${this.sysPrefix}Voice responses are now ${newValue ? 'ENABLED' : 'DISABLED'}.`
        );
    }

    // Reaction Mode methods

    private async toggleReactionMode(message: Message, id: string, isDM: boolean, enable: boolean) {
        if (isDM) {
            await message.reply(`${this.sysPrefix}Reaction mode is only available in servers, not in DMs.`);
            return;
        }

        this.state.updateConfig(id, isDM, { reactionModeEnabled: enable });
        await message.reply(`${this.sysPrefix}Reaction mode ${enable ? 'enabled' : 'disabled'}.`);
    }

    private async addReactionChannel(message: Message, id: string, isDM: boolean, channelName: string) {
        if (isDM) {
            await message.reply(`${this.sysPrefix}Reaction mode is only available in servers, not in DMs.`);
            return;
        }

        if (!channelName) {
            await message.reply(`${this.sysPrefix}Please specify a channel name.`);
            return;
        }

        const config = this.state.getConfig(id, isDM);
        const channelId = this.getChannelIdFromName(message, channelName);

        if (!channelId) {
            await message.reply(`${this.sysPrefix}Could not find channel "${channelName}".`);
            return;
        }

        if (config.reactionChannels.includes(channelId)) {
            await message.reply(`${this.sysPrefix}Channel "${channelName}" is already in the reaction list.`);
            return;
        }

        const newChannels = [...config.reactionChannels, channelId];
        this.state.updateConfig(id, isDM, { reactionChannels: newChannels });
        await message.reply(`${this.sysPrefix}Added channel "${channelName}" to reaction mode.`);
    }

    private async removeReactionChannel(message: Message, id: string, isDM: boolean, channelName: string) {
        if (isDM) {
            await message.reply(`${this.sysPrefix}Reaction mode is only available in servers, not in DMs.`);
            return;
        }

        if (!channelName) {
            await message.reply(`${this.sysPrefix}Please specify a channel name.`);
            return;
        }

        const config = this.state.getConfig(id, isDM);
        const channelId = this.getChannelIdFromName(message, channelName);

        if (!channelId) {
            await message.reply(`${this.sysPrefix}Could not find channel "${channelName}".`);
            return;
        }

        if (!config.reactionChannels.includes(channelId)) {
            await message.reply(`${this.sysPrefix}Channel "${channelName}" is not in the reaction list.`);
            return;
        }

        const newChannels = config.reactionChannels.filter(c => c !== channelId);
        this.state.updateConfig(id, isDM, { reactionChannels: newChannels });
        await message.reply(`${this.sysPrefix}Removed channel "${channelName}" from reaction mode.`);
    }

    private getChannelIdFromName(message: Message, channelName: string): string | null {
        if (!message.guild) return null;

        // Remove # if present
        const name = channelName.startsWith('#') ? channelName.substring(1) : channelName;

        // Try to find the channel by name
        const channel = message.guild.channels.cache.find(
            c => c.name.toLowerCase() === name.toLowerCase()
        );

        return channel?.id || null;
    }

    // Method to handle message reactions
    async handleReaction(message: Message) {
        if (!message.guild) return; // Only work in guilds
        if (message.author.bot) return; // Skip if message is from a bot

        const id = message.guild.id;
        const config = this.state.getConfig(id, false);
        // Skip if reaction mode is disabled or no channels configured
        if (!config.reactionModeEnabled || config.reactionChannels.length === 0) return;

        // Skip if channel is not in the reaction list
        if (!config.reactionChannels.includes(message.channel.id)) return;

        // Only wait for embeds if message contains URLs
        if (this.hasURLs(message.content)) {
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Generate an appropriate emoji reaction
        const emoji = await this.generateEmojiReaction(message);
        if (emoji) {
            try {
                await message.react(emoji);
                // Record the successful reaction for future reference
                this.state.recordReaction(id, false, emoji, message.content, message.channel.id);
                console.log(`🎭 Recorded reaction: ${emoji} for guild ${id}`);
            } catch (error) {
                console.error('Error reacting to message:', error);
            }
        }
    }

    private async generateEmojiReaction(message: Message): Promise<string | null> {
        try {
            // Fetch recent messages from this specific channel for context
            const recentMessages = await message.channel.messages.fetch({ limit: 10 });
            let userMessage = prependTimestampAndUsername(message);
            userMessage += extractEmbedDataToText(message);

            // Convert to an array and sort by timestamp (oldest first)
            const channelHistory = [...recentMessages.values()]
                .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                .map(msg => ({
                    role: "user",
                    content: userMessage
                }));

            // Use the guild config for model settings
            const id = message.guild!.id;
            const config = this.state.getConfig(id, false);
            const systemPrompt = this.getSystemPrompt(id, false);

            // Get recent reactions to encourage variety
            const recentReactions = this.state.getRecentReactions(id, false);
            let reactionContext = '';
            if (recentReactions.length > 0) {
                const recentEmojis = recentReactions.map(r => r.emoji).join(', ');
                reactionContext = `\n\nIMPORTANT: My recent reactions were: ${recentEmojis}. Please choose a different emoji to add variety and avoid repetition.`;
            }

            const messages = [
                ...channelHistory,
                {
                    role: "user",
                    content: `Based on this conversation, please respond to the most recent message with a single emoji that would be an appropriate reaction. Only respond with the emoji itself.${reactionContext}`
                }
            ] as MessageParam[];

            const response = await this.anthropic.messages.create({
                model: config.model,
                max_tokens: 30,
                temperature: config.temperature,
                messages,
                system: systemPrompt?.content || ''
            });

            // Extract just the emoji from the response
            const responseText = response.content[0].type === 'text'
                ? response.content[0].text
                : '';

            const emojiMatch = responseText.trim().match(/^(\p{Emoji}|:\w+:)$/u);
            if (emojiMatch) {
                return emojiMatch[0];
            }

            console.log(`🤖 Generated emoji reaction: ${responseText}`);

            // If no valid emoji found, do nothing
            return null;
        } catch (error) {
            console.error('Error generating emoji reaction:', error);
            return null;
        }
    }

    // Reminder management methods
    private async addReminder(message: Message, id: string, isDM: boolean, args: string[]) {
        if (args.length < 2) {
            await message.reply(`${this.sysPrefix}Usage: \`!remind <time> <message>\`
Examples:
- \`!remind 5m Take a break\`
- \`!remind 2h Check the laundry\`
- \`!remind 1d Review the proposal\`
- \`!remind 30s Quick test\``);
            return;
        }

        const timeStr = args[0];
        const reminderContent = args.slice(1).join(' ');

        // Parse time string (e.g., "5m", "2h", "1d", "30s")
        const timeMatch = timeStr.match(/^(\d+)([smhd])$/i);
        if (!timeMatch) {
            await message.reply(`${this.sysPrefix}Invalid time format. Use: 30s, 5m, 2h, 1d`);
            return;
        }

        const [, amount, unit] = timeMatch;
        const multipliers = {
            's': 1000,           // seconds
            'm': 60 * 1000,      // minutes
            'h': 60 * 60 * 1000, // hours
            'd': 24 * 60 * 60 * 1000 // days
        };

        const delay = parseInt(amount) * multipliers[unit.toLowerCase() as keyof typeof multipliers];
        const triggerTime = new Date(Date.now() + delay);

        // Validate reasonable limits
        if (delay < 10000) { // minimum 10 seconds
            await message.reply(`${this.sysPrefix}Reminder must be at least 10 seconds in the future.`);
            return;
        }
        if (delay > 365 * 24 * 60 * 60 * 1000) { // maximum 1 year
            await message.reply(`${this.sysPrefix}Reminder cannot be more than 1 year in the future.`);
            return;
        }

        const reminder = {
            id: `${message.author.id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            userId: message.author.id,
            channelId: message.channel.id,
            content: reminderContent,
            triggerTime,
            isDM
        };

        this.state.addReminder(reminder);

        await message.reply(
            `${this.sysPrefix}⏰ Reminder set for ${triggerTime.toLocaleString()}!\n` +
            `📝 "${reminderContent}"\n` +
            `🆔 ID: \`${reminder.id}\``
        );
    }

    private async listReminders(message: Message, id: string, isDM: boolean) {
        const userReminders = this.state.getRemindersForUser(message.author.id);

        if (userReminders.length === 0) {
            await message.reply(`${this.sysPrefix}You have no active reminders.`);
            return;
        }

        const reminderList = userReminders
            .sort((a, b) => a.triggerTime.getTime() - b.triggerTime.getTime())
            .map(reminder => {
                const timeLeft = reminder.triggerTime.getTime() - Date.now();
                const timeStr = timeLeft > 0
                    ? `in ${this.formatTimeLeft(timeLeft)}`
                    : 'overdue';

                return `⏰ ${reminder.triggerTime.toLocaleString()} (${timeStr})\n` +
                    `📝 "${reminder.content}"\n` +
                    `🆔 \`${reminder.id}\``;
            })
            .join('\n\n');

        const chunks = this.splitMessageIntoChunks([{ role: 'user', content: reminderList }]);
        await message.reply(`${this.sysPrefix}Your active reminders:`);

        for (const chunk of chunks) {
            if (chunk) await message.channel.send(chunk);
        }
    }

    private formatTimeLeft(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    private async cancelReminder(message: Message, id: string, isDM: boolean, reminderId: string) {
        if (!reminderId) {
            await message.reply(`${this.sysPrefix}Usage: \`!cancelreminder <reminder_id>\``);
            return;
        }

        const reminder = this.state.getReminder(reminderId);
        if (!reminder) {
            await message.reply(`${this.sysPrefix}Reminder not found: \`${reminderId}\``);
            return;
        }

        if (reminder.userId !== message.author.id) {
            await message.reply(`${this.sysPrefix}You can only cancel your own reminders.`);
            return;
        }

        const deleted = this.state.removeReminder(reminderId);
        if (deleted) {
            await message.reply(
                `${this.sysPrefix}✅ Cancelled reminder:\n` +
                `📝 "${reminder.content}"\n` +
                `⏰ Was scheduled for: ${reminder.triggerTime.toLocaleString()}`
            );
        } else {
            await message.reply(`${this.sysPrefix}Failed to cancel reminder.`);
        }
    }

    async toggleLearning(message: Message, id: string, isDM: boolean, enabled: boolean) {
        this.state.updateConfig(id, isDM, { learningEnabled: enabled });
        await message.reply(
            `${this.sysPrefix}Learning questions ${enabled ? 'enabled' : 'disabled'} for ${isDM ? 'DMs' : 'this server'}.`
        );
    }

    async addLearningSubject(message: Message, id: string, isDM: boolean, subject: string) {
        if (!subject.trim()) {
            await message.reply(`${this.sysPrefix}Please specify a subject to add. Usage: !learnadd [subject]`);
            return;
        }

        const config = this.state.getConfig(id, isDM);
        const subjectTrimmed = subject.trim();

        if (config.learningSubjects.includes(subjectTrimmed)) {
            await message.reply(`${this.sysPrefix}"${subjectTrimmed}" is already in the learning subjects list.`);
            return;
        }

        const newSubjects = [...config.learningSubjects, subjectTrimmed];
        this.state.updateConfig(id, isDM, { learningSubjects: newSubjects });

        await message.reply(
            `${this.sysPrefix}Added "${subjectTrimmed}" to learning subjects.\n` +
            `Current subjects: ${newSubjects.join(', ')}\n` +
            `Questions will be spaced throughout the day (every ${Math.round(24 / newSubjects.length * 10) / 10} hours per subject).`
        );
    }

    async removeLearningSubject(message: Message, id: string, isDM: boolean, subject: string) {
        if (!subject.trim()) {
            await message.reply(`${this.sysPrefix}Please specify a subject to remove. Usage: !learnremove [subject]`);
            return;
        }

        const config = this.state.getConfig(id, isDM);
        const subjectTrimmed = subject.trim();

        if (!config.learningSubjects.includes(subjectTrimmed)) {
            await message.reply(
                `${this.sysPrefix}"${subjectTrimmed}" is not in the learning subjects list.\n` +
                `Current subjects: ${config.learningSubjects.join(', ') || 'none'}`
            );
            return;
        }

        const newSubjects = config.learningSubjects.filter(s => s !== subjectTrimmed);
        this.state.updateConfig(id, isDM, { learningSubjects: newSubjects });

        await message.reply(
            `${this.sysPrefix}Removed "${subjectTrimmed}" from learning subjects.\n` +
            `Current subjects: ${newSubjects.join(', ') || 'none'}` +
            (newSubjects.length > 0 ? `\nQuestions will be spaced throughout the day (every ${Math.round(24 / newSubjects.length * 10) / 10} hours per subject).` : '')
        );
    }

    async showLearningStatus(message: Message, id: string, isDM: boolean) {
        const config = this.state.getConfig(id, isDM);
        const tracker = this.state.getLearningTracker(id, isDM);

        let status = `📚 **Learning System Status:**\n`;
        status += `🔹 Enabled: ${config.learningEnabled ? '✅' : '❌'}\n`;
        status += `🔹 Subjects: ${config.learningSubjects.join(', ') || 'none'}\n\n`;

        if (config.learningEnabled && config.learningSubjects.length > 0) {
            status += `📊 **Today's Questions:**\n`;
            for (const subject of config.learningSubjects) {
                const count = tracker.dailyQuestionCount.get(subject) || 0;
                const lastTime = tracker.lastQuestionTimes.get(subject);
                const lastTimeStr = lastTime ? new Date(lastTime).toLocaleTimeString() : 'never';
                status += `🔸 ${subject}: ${count} questions (last: ${lastTimeStr})\n`;
            }

            const nextSubject = this.state.getNextQuestionSubject(id, isDM, config.learningSubjects);
            if (nextSubject) {
                status += `\n⏰ Next question: ${nextSubject} (ready now!)`;
            } else {
                const timeUntilNext = this.state.getTimeUntilNextQuestion(id, isDM, config.learningSubjects);
                if (timeUntilNext < Infinity) {
                    const hours = Math.floor(timeUntilNext / (1000 * 60 * 60));
                    const minutes = Math.floor((timeUntilNext % (1000 * 60 * 60)) / (1000 * 60));
                    status += `\n⏰ Next question in: ${hours}h ${minutes}m`;
                }
            }
        }

        await message.reply(status);
    }

    async performLearningQuestion(channel: TextChannel | DMChannel, id: string, isDM: boolean, subject: string) {
        console.log(`📚 Generating learning question for ${isDM ? 'user' : 'guild'}: ${id}, subject: ${subject}`);

        try {
            // Create a prompt specifically for learning questions (not using main system prompt)
            const learningPrompt = LEARNING_PROMPT_TEMPLATE.replace('{SUBJECT}', subject);

            // Generate the learning question using the anthropic API directly
            // We don't use the main generateResponse method to avoid mixing with conversation context
            const response = await this.anthropic.messages.create({
                model: 'claude-3-5-sonnet-latest',
                max_tokens: 300,
                temperature: 0.8,
                messages: [{
                    role: 'user',
                    content: `Create a learning question for ${subject}. Make it engaging and educational.`
                }],
                system: learningPrompt
            });

            const questionText = response.content[0]?.type === 'text' ? response.content[0].text : '';

            if (questionText) {
                // Post the question and add it to the message log so the bot can respond to answers
                const questionMessage = {
                    role: 'assistant',
                    content: `📚 **${subject} Learning Question:**\n\n${questionText}`
                };

                // Add the question to the conversation log so the bot remembers it asked this question
                const log = this.state.getLog(id, isDM);
                log.messages.push(questionMessage);

                // Trim log if needed
                const config = this.state.getConfig(id, isDM);
                if (log.messages.length > config.messageLimit) {
                    log.messages = log.messages.slice(-config.messageLimit);
                }

                // Send the question
                await channel.send(questionMessage.content);

                console.log(`✅ Posted learning question for ${subject}`);
            } else {
                console.error('Failed to generate learning question - empty response');
                await channel.send(`${this.sysPrefix}Sorry, I couldn't generate a learning question right now.`);
            }
        } catch (error) {
            console.error('Error generating learning question:', error);
            await channel.send(`${this.sysPrefix}Error generating learning question: ${error}`);
        }
    }
}
