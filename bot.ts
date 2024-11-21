require('dotenv').config()
import { promisify } from 'util';
import { exec as execCb } from 'child_process';
import https from 'https';
import fs from 'fs';
const pipeline = promisify(require('stream').pipeline);
const exec = promisify(execCb);
import { Attachment, ChannelType, Client as DiscordClient, GatewayIntentBits, Message, TextChannel } from 'discord.js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import dayjs from 'dayjs';
import { help } from './help';
import { getWebpage } from './getWebpage';
import { ChatCompletionMessageParam } from 'openai/resources/chat';
import whisper from './whisper'
import { persist, load } from './persist';
import { JEEVES_PROMPT, TOKIPONA_PROMPT, JARGONATUS_PROMPT } from './prompts';

// Load the Discord bot token and OpenAI API key from the environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const TARGET_CHANNEL_NAME = process.env.TARGET_CHANNEL_NAME
let ourMessageLog: { role: string, content: string }[] = []
type BotMode = 'jeeves' | 'tokipona' | 'jargon' | 'whisper' | 'customprompt'
let mode: BotMode = 'jeeves'
let messageLimit = 20
let temperature = 0.9
let guildId: string | null = null
let MAX_RESPONSE_LENGTH_TOKENS = 1000
let SHOULD_SAVE_DATA = true
let model = 'claude-3-5-sonnet-latest'
const sysPrefix = '[SYSTEM] '
let messageBuffer: { role: string, content: string }[] = [];
let responseTimer: NodeJS.Timeout | null = null;
let RESPONSE_DELAY_MS = 10000; // 10 seconds
let MUSE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
let SHOULD_MUSE_REGULARLY = true
// let RIEC_RESPOND_IN_EVERY_CHANNEL = false
// let riecMessageBuffer: ChatCompletionMessageParam[] = [];

// Replace the constant with a variable
let ALLOW_DMS = process.env.ALLOW_DMS === 'true'

console.log('initializing openai...')
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
})
const anthropic = new Anthropic({
    apiKey: ANTHROPIC_API_KEY,
})

console.log('initializing discord...')
const discord = new DiscordClient({
    intents: [
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.DirectMessageReactions
    ]
})!

discord.on('raw', async (event) => {
    console.log('Raw event received:', event.t);
});

discord.once('ready', async () => {
    console.log('Discord client ready. Logging in...')
    console.log('Intents configured:', discord.options.intents)
    await discord.login(DISCORD_BOT_TOKEN)
    console.log(`Logged in as ${discord!.user!.tag}!`, discord.isReady())
    guildId = discord.guilds.cache.first()?.id || null
    console.log('Loading persisted data...')
    if (guildId) {
        try {
            const data = await load(guildId)
            if (data) {
                ourMessageLog = data.ourMessageLog
                mode = data.mode
                MAX_RESPONSE_LENGTH_TOKENS = data.MAX_RESPONSE_LENGTH_TOKENS
                RESPONSE_DELAY_MS = data.RESPONSE_DELAY_MS
                SHOULD_MUSE_REGULARLY = data.SHOULD_MUSE_REGULARLY
                MUSE_INTERVAL = data.MUSE_INTERVAL
                temperature = data.temperature
                model = data.model
                SHOULD_SAVE_DATA = data.SHOULD_SAVE_DATA
                messageLimit = data.messageLimit
                // RIEC_RESPOND_IN_EVERY_CHANNEL = data.RESPOND_IN_EVERY_CHANNEL
                ALLOW_DMS = data.ALLOW_DMS
            }
            console.log('Loaded persisted data.')
        } catch (e) {
            console.error('Error loading persisted data:', e)
        }
    }
    beginMuseTimer()
    const channels = discord.channels.cache.filter(channel => channel.type === ChannelType.GuildText && channel.name === TARGET_CHANNEL_NAME);
    await syncProfileWithMode()

    if (channels.size > 0) {
        channels.forEach(async channel => {
            channel.type === ChannelType.GuildText && await channel.send('Your Jeeves is online, sir.');
        });
    }
})

discord.on('error', async (e) => {
    console.error(e)
})

function splitMessageIntoChunks(msgs: { role: string, content: string }[]) {
    const MAX_CHUNK_SIZE = 1900;
    let chunks: string[] = [];

    msgs.forEach(msg => {
        let content = msg.content;
        while (content.length > 0) {
            const chunk = content.slice(0, MAX_CHUNK_SIZE);
            chunks.push(chunk);
            content = content.slice(MAX_CHUNK_SIZE);
        }
    });

    return chunks;
}

async function syncProfileWithMode() {
    switch (mode) {
        case 'tokipona':
            await setBotProfile('ilo sona', 'https://www.jonathangabel.com/images/t47_tokipona/jan_ante/inkepa.mumumu.jpg')
            break
        case 'jargon':
            await setBotProfile('JARGONATUS', 'https://user-images.githubusercontent.com/10970247/229021007-1b4fd5e5-3c66-4290-a20f-3c47af0de760.png')
            break
        case 'whisper':
            await setBotProfile('Scribe', '')
            break
        case 'customprompt':
            await setBotProfile('Homuncules', '')
            break
        case 'jeeves':
        default:
            await setBotProfile('Jeeves', 'https://blog-assets.mugglenet.com/wp-content/uploads/2013/01/my-man-jeeves-768x1220.jpg')
            break
    }
}

async function setBotProfile(username: string, avatarUrl: string) {
    try {
        await discord.user?.setUsername(username);
        await discord.user?.setAvatar(avatarUrl);
    } catch (error) {
        console.error('Error setting bot profile:', error);
    }
}

discord.on('messageCreate', async (message) => {
    console.log('messageCreate', {
        content: message.content,
        author: message.author.tag,
        channelType: message.channel.type,
        isDM: message.channel.type === ChannelType.DM,
        guildId: message.guildId
    })

    if (!discord.user) {
        console.log('No discord user found - returning early')
        return
    }

    // Check if message is from a DM or allowed channel
    const isValidChannel =
        (message.channel.type === ChannelType.DM && ALLOW_DMS) ||
        ((message.channel as TextChannel)?.name === TARGET_CHANNEL_NAME)

    if (!isValidChannel) {
        console.log('Invalid channel - returning early', {
            isDM: message.channel.type === ChannelType.DM,
            allowDMs: ALLOW_DMS,
            channelName: (message.channel as TextChannel)?.name,
            targetChannel: TARGET_CHANNEL_NAME
        })
        return
    }

    guildId = message.guildId

    console.log('messageCreate', message.content, 'from', message.author.tag)

    if (message.author.bot) {
        // ignore our system messages
    } else if (message.content[0] === '!') {
        // commands get special treatment
        await respondToCommand(message)
    } else {
        // respond as normal
        let userMessage = message.content
        if (userMessage.match(/^!empty/)) {
            userMessage = ''
        }
        let audio: Attachment | undefined;
        for (const [messageID, attachment] of message.attachments) {
            // console.log('found attachment', messageID, attachment)
            if (attachment.name.match(/\.(mp3|ogg|wav)$/)) {
                audio = attachment
                break
            }
        }

        if (audio) {
            userMessage ||= await transcribeAudio_maybeReply(audio, message)
            const firstWord = userMessage.split(' ')[0]
            const secondWord = userMessage.split(' ')[1].replace(/[^a-zA-Z0-9]/g, '')
            const rest = userMessage.slice(userMessage.indexOf(secondWord) + secondWord.length).trim()
            if (firstWord.toLocaleLowerCase().startsWith('command')) {
                try {
                    await message.reply(`${sysPrefix}Detected voice command: \`${secondWord}\`.`)
                } catch { }
                // mutate in place baby!
                message.content = `!${secondWord.trim().replace('!', '')} ${rest}`.toLocaleLowerCase()
                return respondToCommand(message)
            }
        }

        if (mode === 'whisper') {
            if (!message.attachments.size) {
                await message.reply(sysPrefix + 'Please send an audio message to receive a transcription, or switch modes (!help) to chat with a persona.')
            }
            return // transcription mode has already sent the message with the transcription by this point
        }

        messageBuffer.push({
            role: 'user',
            content: `${dayjs().format('MM/DD/YYYY HH:mm:ss')} [${message.author.username}]: ${userMessage}`
        })

        if (responseTimer) {
            clearTimeout(responseTimer);
        }

        // Set a new timer
        responseTimer = setTimeout(async () => {
            // Process all buffered messages
            ourMessageLog.push(...messageBuffer);
            while (messageLimit > 0 && ourMessageLog.length > messageLimit) ourMessageLog.shift();

            console.log('Buffered Messages: ', messageBuffer.map(msg => msg.content).join('\n'));

            if ((message.channel as TextChannel).name === TARGET_CHANNEL_NAME) {
                let chunx: string[] = [];
                try {
                    message.channel.sendTyping()
                    chunx.push(...splitMessageIntoChunks([await generateResponse() as any]))
                } catch (er) {
                    console.error('Error chunking message:', er)
                }

                console.log(chunx);
                if (chunx.length) {
                    chunx.forEach(async chunk => {
                        try {
                            if (chunk.length > 0)
                                await message.reply(chunk);
                        } catch (err) {
                            await message.channel.send(sysPrefix + '[ERROR] error sending a message.');
                            console.log(err);
                        }
                    });
                } else {
                    await message.channel.send(sysPrefix + '[ERROR] no messages to send.');
                }
            }

            // Clear the buffer and timer
            messageBuffer = [];
            responseTimer = null;
        }, RESPONSE_DELAY_MS);
    }
})

const transcribeAudio_maybeReply: (attachment: Attachment, message: Message) => Promise<string> = async (audio: Attachment, message: Message) => {
    await message.channel.sendTyping()
    let audioMessageContent = ''

    // Download the audio file
    const file = fs.createWriteStream('audio.mp3');
    const response = await new Promise((resolve, reject) => {
        https.get(audio!.proxyURL, resolve).on('error', reject);
    });

    await pipeline(
        response,
        file
    );

    try {
        await message.channel.sendTyping()
        const transcription = await whisper(openai, 'audio.mp3')

        if (!transcription?.text?.length) {
            await message.reply(sysPrefix + '[ERROR] Could not process audio.')
            return ''
        } else {
            audioMessageContent = transcription.text
            console.log(`whisper: ${audioMessageContent}`);
            await message.reply(`${sysPrefix}Transcription: ${audioMessageContent}`)
        }
    } catch (error) {
        await message.reply(sysPrefix + '[ERROR] Could not process audio.')
        console.log(`whisper error: ${JSON.stringify(error)}`);
        return ''
    }
    return audioMessageContent
}

const respondToCommand: (message: Message) => Promise<void> = async (message: Message) => {
    if (!discord?.user) return
    const command = unzap(message.content.split(' ')[0])
    switch (command) {
        case 'clear': {
            ourMessageLog = []
            await message.reply(sysPrefix + 'Cleared messages log.')
            break
        }
        case 'jeeves': {
            ourMessageLog = []
            mode = 'jeeves'
            await syncProfileWithMode()
            await message.reply(sysPrefix + 'I have switched to Jeeves mode, sir.')
            break
        }
        case 'tokipona': {
            ourMessageLog = []
            mode = 'tokipona'
            await syncProfileWithMode()
            await message.reply(sysPrefix + 'mi ante e nasin tawa toki pona.')
            break
        }
        case 'jargon': {
            ourMessageLog = []
            mode = 'jargon'
            await syncProfileWithMode()
            await message.reply(sysPrefix + '`# Even in death, I serve the Omnissiah.`')
            break
        }
        case 'whisper': {
            ourMessageLog = []
            mode = 'whisper'
            await syncProfileWithMode()
            break
        }
        case 'temperature': {
            const parsed = message.content.match(/^!temperature ([0-9.]+)$/)
            const requestedTemp = Number(parsed && parsed[1])
            if (!isNaN(requestedTemp) && requestedTemp > 0 && requestedTemp <= 2) {
                temperature = requestedTemp
                await message.reply(sysPrefix + `Temperature set to \`${temperature}\`.`)
            } else {
                await message.reply(sysPrefix + `Couldn't parse requested temperature: \`${requestedTemp}\`. Must be a decimal between 0 and 2.`)
            }
            break
        }
        case 'model': {
            const parsed = message.content.match(/^!model ([\w.-]+)$/)
            const requestedModel = String(parsed && parsed[1])
            if (requestedModel) {
                model = requestedModel
                await message.reply(sysPrefix + `Model set to \`${requestedModel}\`.`)
            } else {
                await message.reply(sysPrefix + `Couldn't parse requested model: \`${parsed}\`.`)
            }
            break
        }
        case 'parrot': {
            const parsed = message.content.slice(8)
            await message.reply(sysPrefix + 'Parroting previous message.')
            const chunx = splitMessageIntoChunks([{ role: 'user', content: parsed }])
            console.log(chunx)
            chunx.forEach(async chunk => {
                if (!chunk) return
                try {
                    await message.channel.send(chunk)
                } catch (e) {
                    await message.channel.send(sysPrefix + '[ERROR] Failed to send a message.')
                }
            })
            break
        }
        case 'prompt': {
            const parsed = message.content.slice(8)
            ourMessageLog = []
            userMsg.content = parsed
            mode = 'customprompt'
            await syncProfileWithMode()
            await message.reply(sysPrefix + 'Prompt set to:')
            const chunx = splitMessageIntoChunks([{ role: 'user', content: parsed }])
            console.log(chunx)
            chunx.forEach(async chunk => {
                if (!chunk) return
                try {
                    await message.channel.send(chunk)
                } catch (e) {
                    await message.channel.send(sysPrefix + '[ERROR] Failed to send a message.')
                }
            })
            break
        }
        case 'limit': {
            const parsed = message.content.match(/^!limit (\d+)$/)
            const requestedLimit = Number(parsed && parsed[1])
            if (!isNaN(requestedLimit) && requestedLimit > 0) {
                messageLimit = requestedLimit
                await message.reply(sysPrefix + `Message memory is now ${messageLimit} messages.`)
            } else {
                await message.reply(sysPrefix + `Failed to parse requested limit.
Found: \`${parsed}\`
Format: \`!limit X\` where X is a number greater than zero.`)
            }
            break
        }
        case 'help': {
            const helpTexts = [
                `# JEEVESPT
- Remembers the last ${messageLimit} messages (yours and his)
- Temperature: ${temperature}
- Model: ${model}
- Response delay: ${RESPONSE_DELAY_MS / 1000} seconds
- Muse interval: ${MUSE_INTERVAL / 60 / 60 / 1000} hours
- Automatic muse: ${SHOULD_MUSE_REGULARLY ? 'enabled' : 'disabled'}
- Current mode: \`${mode}\`
- Max response length (tokens): ${MAX_RESPONSE_LENGTH_TOKENS}
- Persist data: ${SHOULD_SAVE_DATA ? 'enabled' : 'disabled'}
- Direct messages: ${ALLOW_DMS ? 'enabled' : 'disabled'}
- Not actually Jeeves. :(`,
                ...help
            ]
            helpTexts.forEach(async text => {
                await message.channel.send(text)
            })
            break
        }
        case 'delay': {
            const parsed = message.content.match(/^!delay (\d+)$/)
            const requestedDelay = Math.round(Number(parsed && parsed[1]))
            if (!isNaN(requestedDelay) && requestedDelay > 0) {
                await message.reply(sysPrefix + `Response delay set to ${requestedDelay} seconds.`)
                RESPONSE_DELAY_MS = requestedDelay * 1000
            } else {
                await message.reply(sysPrefix + `Failed to parse requested delay. Found: \`${parsed}\`. Format: \`!delay SECONDS\` wherex SECONDS is a number greater than zero.`)
            }
            break
        }
        case 'muse': {
            const parsed = message.content.match(/^!muse (.*)$/)
            if (parsed) {
                muse(parsed[1])
            } else {
                muse()
            }
            break
        }
        case 'museon': {
            SHOULD_MUSE_REGULARLY = true
            await message.reply(sysPrefix + 'Muse will now happen automatically.')
            break
        }
        case 'museoff': {
            SHOULD_MUSE_REGULARLY = false
            await message.reply(sysPrefix + 'Muse will no longer happen automatically.')
            break
        }
        case 'museinterval': {
            const parsed = message.content.match(/^!museinterval (\d+)$/)
            const requestedInterval = Math.round(Number(parsed && parsed[1]))
            MUSE_INTERVAL = requestedInterval * 60 * 60 * 1000
            await message.reply(sysPrefix + `Muse interval set to ${requestedInterval} hours.`)
            break
        }
        case 'empty': {
            message.channel.sendTyping()
            const response = await generateResponse()
            if (response && 'text' in response) {
                await message.reply(response.text || '')
            }
            break
        }
        case 'log': {
            const logAsString = JSON.stringify(ourMessageLog, null, 2)
            const chunx = splitMessageIntoChunks([{ role: 'assistant', content: logAsString }])
            await message.reply(sysPrefix + 'CURRENT MEMORY:\n---')
            chunx.forEach(async m => m && await message.channel.send(m))
            await message.channel.send(sysPrefix + '---')
            break
        }
        case 'prices': {
            const prices = await fetchOpenAIPrices();
            if (prices) {
                await message.reply(sysPrefix + 'Current OpenAI API prices:\n' + JSON.stringify(prices, null, 2));
            } else {
                await message.reply(sysPrefix + '[ERROR] Could not fetch OpenAI API prices.');
            }
            break
        }
        case 'tokens': {
            const parsed = message.content.match(/^!tokens (\d+)$/)
            const requestedTokens = Number(parsed && parsed[1])
            if (!isNaN(requestedTokens) && requestedTokens > 0) {
                MAX_RESPONSE_LENGTH_TOKENS = requestedTokens
                await message.reply(sysPrefix + `Max response length set to ${requestedTokens} tokens.`)
            } else {
                await message.reply(sysPrefix + `Failed to parse requested tokens. Found: \`${parsed}\`. Format: \`!tokens TOKENS\` where TOKENS is a number greater than zero.`)
            }
            break
        }
        case 'persist': {
            SHOULD_SAVE_DATA = !SHOULD_SAVE_DATA
            await message.reply(sysPrefix + `Bot will now ${SHOULD_SAVE_DATA ? 'SAVE' : 'NOT SAVE'} data to disk.`)
            break
        }
        case 'dms': {
            ALLOW_DMS = !ALLOW_DMS
            await message.reply(sysPrefix + `Direct messages are now ${ALLOW_DMS ? 'ENABLED' : 'DISABLED'}.`)
            break
        }
        default:
            try {
                await message.reply(`${sysPrefix}Unrecognized command "${command}".`)
            } catch { }
            break
    }
}

const unzap = (s: string) => (s[0] === '!') ? s.slice(1) : s

const jeevesMsg = {
    role: 'system',
    content: JEEVES_PROMPT
}

const tokiponaMsg = {
    role: 'system',
    content: TOKIPONA_PROMPT
}

const jargonMsg = {
    role: 'system',
    content: JARGONATUS_PROMPT
}

const userMsg = {
    role: 'system',
    content: ''
}

const getSystemPrompt = () => {
    if (mode === 'tokipona') return tokiponaMsg
    if (mode === 'jargon') return jargonMsg
    if (mode === 'whisper') return null
    if (mode === 'customprompt') return userMsg
    return jeevesMsg
}

async function generateResponse(additionalMessages: { role: string, content: string }[] = []) {
    const latestMessages = [getSystemPrompt(), ...ourMessageLog, ...additionalMessages] as { role: string, content: string }[]

    try {
        const completion = await anthropic.messages.create({
            model: model,
            messages: latestMessages.map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content as string
            })),
            temperature,
            max_tokens: MAX_RESPONSE_LENGTH_TOKENS
        })
        console.log(JSON.stringify({ completion }, null, 2))
        const botMsg = completion.content[0]
        if (botMsg?.type === 'text') {
            const response = { role: 'assistant', content: botMsg.text }
            ourMessageLog.push(response)
            return response
        } else {
            return null
        }
    } catch (error) {
        const msg = sysPrefix + 'Error generating response: ' + JSON.stringify(error)
        console.error(error)
        return {
            role: 'assistant',
            content: msg
        }
    }
}

async function getRandomWikipediaPage() {
    const response = await fetch('https://en.wikipedia.org/api/rest_v1/page/random/summary');
    const data = await response.json();
    return data;
}

let museTimer: NodeJS.Timeout

async function beginMuseTimer() {
    let lastMessageTimestamp = Date.now();

    discord.on('messageCreate', (message) => {
        if ((message.channel as TextChannel)?.name === TARGET_CHANNEL_NAME && !message.author.bot) {
            console.log('message received, resetting muse timer')
            lastMessageTimestamp = Date.now();
        }
    });

    museTimer = setInterval(async () => {
        if (Date.now() - lastMessageTimestamp >= MUSE_INTERVAL) {
            console.log('muse timer expired, starting muse')
            if (SHOULD_MUSE_REGULARLY) {
                await muse()
            }
            lastMessageTimestamp = Date.now(); // Reset the timer after musing
        }
    }, 60000);
}


const fetchOpenAIPrices = async () => {
    try {
        const response = await fetch('https://api.openai.com/v1/prices', {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            }
        });
        if (!response.ok) {
            throw new Error('Failed to fetch prices');
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching OpenAI prices:', error);
        return null;
    }
};

async function muse(url?: string) {
    const channels = discord.channels.cache.filter(channel => channel.type === ChannelType.GuildText && channel.name === TARGET_CHANNEL_NAME);

    channels.forEach(async channel => {
        (channel as TextChannel).sendTyping()
    })

    let pageText = ''
    try {
        if (url) {
            pageText = await getWebpage(url)
        } else {
            let wikipage = await getRandomWikipediaPage()
            pageText = wikipage.extract;
            url = wikipage.content_urls?.desktop?.page
        }
    } catch (error) {
        console.error('Error fetching webpage:', error);
        channels.forEach(async channel => {
            await (channel as TextChannel).send(`${sysPrefix}Error fetching webpage (${url || 'random'}): ${error}`)
        })
        return;
    }

    if (channels.size > 0) {
        const prompt: { role: string, content: string } = {
            role: 'system',
            content: `It's been a while since the last message. It's up to you to inject some activity into the situation! Please read the following webpage.

=== BEGIN WEBPAGE ===
${pageText}
=== END WEBPAGE ===

Please consider the implications of this webpage, which may be relevant to recent discussions. Read it carefully, and bring some insight to the discussion. Try to extract something new. Don't just summarize it! We want to engage in a way that is interesting to the audience. Be creative, think step by step, and wow the audience with your ability to synthesize pithy witticisms from many domains of knowledge.

Respond in at most 280 characters - this is a chatroom, not a blog post.

And remember, you are in ${mode} mode. Please conform to the instructions, it's very important! :)

If there was an error fetching the webpage, please mention this, as the developer will want to fix his code.
`
        }

        console.log(prompt)

        const response = await generateResponse([prompt])
        if (response && 'text' in response) {
            channels.forEach(async channel => {
                for (const chunk of splitMessageIntoChunks([{ role: 'assistant', content: response.text as string }])) {
                    await (channel as TextChannel).send(chunk)
                }
                if (url) {
                    await (channel as TextChannel).send(url);
                }
            });
        }
    }
}

discord.login(DISCORD_BOT_TOKEN)

// alert when going offline
process.on('SIGINT', async () => {
    console.log('Received SIGINT. Shutting down gracefully...');

    if (guildId && SHOULD_SAVE_DATA) {
        persist(guildId, {
            ourMessageLog,
            mode,
            MAX_RESPONSE_LENGTH_TOKENS,
            RESPONSE_DELAY_MS,
            SHOULD_MUSE_REGULARLY,
            MUSE_INTERVAL,
            temperature,
            model,
            SHOULD_SAVE_DATA,
            messageLimit,
            ALLOW_DMS,
        })
    }

    const channels = discord.channels.cache.filter(channel => channel.type === ChannelType.GuildText && channel.name === TARGET_CHANNEL_NAME);

    if (channels.size > 0) {
        for (const channel of channels.values()) {
            try {
                await (channel as TextChannel).send('Your Jeeves is going offline, sir.');
            } catch (error) {
                console.error('Error sending offline message:', error);
            }
        }
    }

    discord.destroy();
    process.exit(0);
});