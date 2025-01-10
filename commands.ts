import { Attachment, Message } from 'discord.js';
import { BotState } from './bot';
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import whisper from './whisper';
import { JEEVES_PROMPT, TOKIPONA_PROMPT, JARGONATUS_PROMPT } from './prompts';
import dayjs from 'dayjs';
import { help } from './help';
import { getWebpage } from './getWebpage';
import https from 'https';
import fs from 'fs';
import { promisify } from 'util';
import { MessageParam } from '@anthropic-ai/sdk/resources';
import { ElevenLabs } from './elevenlabs';
const pipeline = promisify(require('stream').pipeline);

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
        const config = this.state.getConfig(id, isDM);

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

            default:
                await message.reply(`${this.sysPrefix}Unrecognized command "${command}".`);
        }
    }

    async handleMessage(message: Message, isDM: boolean) {
        console.log(`📨 Processing message from ${isDM ? 'DM' : 'guild'} (${message.author.tag})`);
        const id = isDM ? message.author.id : message.guild!.id;
        const buffer = this.state.getBuffer(id, isDM);
        const log = this.state.getLog(id, isDM);
        const config = this.state.getConfig(id, isDM);

        let userMessage = message.cleanContent;

        // Handle audio attachments if present
        let audio: Attachment | undefined;
        for (const [messageID, attachment] of message.attachments) {
            if (attachment.name.match(/\.(mp3|ogg|wav)$/)) {
                audio = attachment;
                break;
            } else if (
                attachment.size < 50000 && // Increased to 50KB for more reasonable file sizes
                (
                    attachment.contentType?.startsWith('text/') ||
                    attachment.name.match(/\.(txt|md|json|yaml|yml|csv|log|ts|js|py|html|css|tsx|jsx|mdx|rtf|py)$/)
                )
            ) {
                console.log(`🔍 Processing text file: ${attachment.name}`);
                const content = await this.downloadAndReadFile(attachment.proxyURL, `text_${message.author.id}_${Date.now()}.txt`);
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

        // Add message to both buffer and log
        const formattedMessage = {
            role: 'user',
            content: `${dayjs().format('MM/DD/YYYY HH:mm:ss')} [${message.author.username}]: ${userMessage}`
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

        // Set new timer for response
        buffer.responseTimer = setTimeout(
            () => this.sendDelayedResponse(message, isDM),
            config.responseDelayMs
        );
    }

    private async downloadFile(url: string, filename: string): Promise<void> {
        try {
            console.log(`🔍 Downloading file from ${url} to ${filename}`);
            const response = await new Promise((resolve, reject) => {
                https.get(url, resolve).on('error', reject);
            });
            console.log(`🔍 Downloaded file from ${url} to ${filename}`);
            await pipeline(response, fs.createWriteStream(filename));
        } catch (error) {
            console.error(`❌ Error downloading file ${filename}:`, error);
            throw error;
        }
    }

    private async downloadAndReadFile(url: string, filename: string): Promise<string> {
        await this.downloadFile(url, filename);
        const content = fs.readFileSync(filename, 'utf8');
        console.log(`🔍 Read file from ${filename}: ${content.slice(0, 100)}...`);
        fs.unlinkSync(filename);
        return content;
    }

    private async transcribeAudio(attachment: Attachment, message: Message): Promise<string> {
        const timestamp = Date.now();
        const userId = message.author.id;
        const filename = `audio_${userId}_${timestamp}.mp3`;

        console.log(`🎙️ Processing audio from ${message.author.tag} (${filename})`);
        await message.channel.sendTyping();

        try {
            // Download the audio file with unique name
            await this.downloadFile(attachment.proxyURL, filename);
            console.log(`📥 Downloaded audio file: ${filename}`);

            const transcription = await whisper(this.openai, filename);
            if (!transcription?.text?.length) {
                await message.reply(this.sysPrefix + '[ERROR] Could not process audio.');
                return '';
            }

            console.log(`✍️ Transcribed audio for ${message.author.tag}`);
            await message.reply(`${this.sysPrefix}Transcription: ${transcription.text}`);
            return transcription.text;
        } catch (error) {
            console.error(`❌ Whisper error for ${filename}:`, error);
            await message.reply(this.sysPrefix + '[ERROR] Could not process audio.');
            return '';
        } finally {
            // Cleanup
            try {
                fs.unlinkSync(filename);
                console.log(`🧹 Cleaned up audio file: ${filename}`);
            } catch (error) {
                console.error(`Error cleaning up audio file ${filename}:`, error);
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

    private async generateResponse(
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
            systemPrompt,
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
                max_tokens: config.maxResponseLength
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

    private getSystemPrompt(id: string, isDM: boolean): { role: string, content: string } | null {
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
} 