/**
 * Command Handler - Main entry point for the refactored command system
 *
 * This module provides backwards-compatible API while using the new
 * command registry pattern internally.
 */

import { Attachment, Message, TextChannel, DMChannel, TextBasedChannel, ChatInputCommandInteraction, Interaction } from 'discord.js';
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';

import { BotState, isXaiModel, ScheduledReminder } from '../state';
import { ElevenLabs } from '../elevenlabs';
import { synthesizeIPA } from '../ipaSpeech';
import dayjs from 'dayjs';
import { JEEVES_PROMPT, JEEVES_GROK_ADDENDUM, TOKIPONA_PROMPT, WEB_SEARCH_ADDENDUM } from '../prompts/prompts';
import { allMessageAttachments } from '../formatMessage';
import whisper from '../whisper';
import { generateText, withSourcesFooter } from '../llm/generate';
import { AGENT_TOOLS, ChatParticipant, createFollowupTool, createProposeSettingTool, createRememberTool } from '../llm/tools';
import { isTypesafeConfigured } from '../llm/typesafe';
import { ChatLine, channelHistory, snippet, toLlmMessages } from '../chat/history';
import { AmbientTracker, decide, medianWords, REACT_COST, REPLY_COST, RESPONDS_THRESHOLD } from '../chat/ambient';
import { guildCustomEmoji, judgeConversation } from '../chat/gate';
import { describeSettingsForAgent, SettingProposal } from '../settings/schema';
import { buildProposalMessage, handleSettingsInteraction, isSettingsInteraction } from '../settings/panel';
import { handleListInteraction, isListInteraction } from './listPanel';

import { CommandContext, CommandDependencies, GeneratedResponse } from './types';
import { CommandRegistry, registry } from './registry';
import { commandUtils, CommandUtilsImpl, canExecuteCommand, isSendableChannel } from './utils';
import {
    SYS_PREFIX,
    ALLOWED_DOMAINS, TEMP_DIR, TASK_AGENT_WEB_SEARCH_MAX_USES
} from './constants';

// Import command modules
import { configCommands } from './config';
import { modeCommands } from './modes';
import { MuseHandler, museCommand } from './muse';
import { settingsCommands } from './settings';
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
import { shortenCommands } from './shorten';
import { notesCommands } from './notes';

import fs from 'fs';
import https from 'https';
import path from 'path';
import { URL } from 'url';
import { promisify } from 'util';
import { LUGSO_NONTHINKING_PROMPT, LUGSO_PROMPT, LUGSO_THINKING_PROMPT } from '../prompts/lugso';
const pipeline = promisify(require('stream').pipeline);

/** Messages the ambient gate reads. */
const GATE_HISTORY = 20;
/** Cap on an unprompted remark's length; it should be a line or two. */
const AMBIENT_MAX_TOKENS = 400;

/** What a channel does with a new message (see server.ts routing). */
export type ResponseTrigger = 'reply' | 'ambient' | 'none';

/** An unprompted (or Jev-detected direct) reply in an ambient channel. */
export interface AmbientReply {
    /** The message being answered. */
    target: ChatLine;
    latestId: string;
    /** Nobody addressed us: keep it short and track whether anyone responds. */
    unprompted: boolean;
}

export interface GenerateOptions {
    /** Offer propose_setting_change (and, with a channel, the people tools). */
    allowProposals?: boolean;
    /** Read the conversation from this channel's history. */
    channel?: any;
    ambient?: AmbientReply;
}

/**
 * CommandHandler - Backwards-compatible class that uses the new registry
 */
export class CommandHandler {
    private deps: CommandDependencies;
    private utils: CommandUtilsImpl;
    private museHandler: MuseHandler;
    /** Per-channel debounce: reply (or run the gate) once the conversation settles. */
    private replyTimers = new Map<string, NodeJS.Timeout>();
    /** Ambient channels where someone @mentioned or replied to us since the last reply. */
    private directlyAddressed = new Set<string>();
    private ambient = new AmbientTracker();

    constructor(
        private state: BotState,
        private openai: OpenAI,
        private xai: OpenAI,
        private anthropic: Anthropic,
        private elevenLabs: ElevenLabs,
        private poolside?: OpenAI
    ) {
        this.deps = { state, openai, xai, anthropic, elevenLabs, poolside };
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
            ...settingsCommands,
            ...modeCommands,
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
            ...sitelenCommands,
            ...shortenCommands,
            ...notesCommands
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
     * Handle a button / select menu / modal. Settings panels and proposals use
     * `cfg:` custom_ids; managed lists (reminders, tasks, …) use `lst:`.
     * Anything else (e.g. slash-command pagination) is ignored.
     */
    async handleComponent(interaction: Interaction): Promise<void> {
        if (isSettingsInteraction(interaction)) {
            await handleSettingsInteraction(interaction, this.state);
        } else if (isListInteraction(interaction)) {
            await handleListInteraction(interaction, this.deps);
        }
    }

    /**
     * Handle a regular message (not a command).
     *
     * `trigger` says what this channel does with it: 'reply' answers after the
     * response delay, 'ambient' runs the Jev gate to decide whether to join in
     * (replying directly when @mentioned or replied to), 'none' only records.
     * Chat history itself is read from the channel when replying; here we
     * only remember what Discord can't give back (transcripts, file text).
     */
    async handleMessage(message: Message, isDM: boolean, trigger: ResponseTrigger = 'reply'): Promise<void> {
        console.log(`📨 Processing message from ${isDM ? 'DM' : 'guild'} (${message.author.tag}), trigger: ${trigger}`);
        const id = isDM ? message.author.id : message.guild!.id;
        const config = this.state.getConfig(id, isDM);

        const fileNotes: string[] = [];

        // Handle audio attachments if present (including those on a forward)
        let audio: Attachment | undefined;
        for (const attachment of allMessageAttachments(message)) {
            if (attachment.name.match(/\.(mp3|ogg|wav|m4a|aac|flac|webm)$/i)) {
                audio = attachment;
                break;
            } else if (this.utils.isTextFileAttachment(attachment)) {
                console.log(`🔍 Processing text file: ${attachment.name} (${attachment.contentType}, ${attachment.size} bytes)`);
                try {
                    const content = await this.utils.downloadAndReadTextFile(attachment.url, `text_${message.author.id}_${Date.now()}.txt`);
                    const body = this.utils.formatTextAttachment(attachment, content);
                    fileNotes.push(`[SYSTEM] The user attached a text file (${attachment.name}). Here is the content: \n\n ${body}`);
                } catch (error) {
                    console.error(`❌ Error reading text file ${attachment.name}:`, error);
                    fileNotes.push(`[SYSTEM] The user attached a text file (${attachment.name}) but it could not be downloaded.`);
                }
            } else if (this.utils.isTextLikeAttachment(attachment)) {
                console.log(`⚠️ Skipping oversized text file: ${attachment.name} (${attachment.size} bytes)`);
                fileNotes.push(`[SYSTEM] The user attached a text file (${attachment.name}, ${attachment.size} bytes) that is too large to read.`);
            }
        }
        if (fileNotes.length) {
            channelHistory.annotate(message.id, { text: fileNotes.join('\n'), replaces: false });
        }

        if (audio) {
            const transcript = await this.transcribeAudio(audio, message, id, isDM);
            if (transcript) {
                channelHistory.annotate(message.id, { text: `(voice message) ${transcript}`, replaces: true });
                const firstWord = transcript.split(' ')[0];
                const secondWord = transcript.split(' ')[1]?.replace(/[^a-zA-Z0-9]/g, '') || '';
                const rest = transcript.slice(transcript.indexOf(secondWord) + secondWord.length).trim();

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
        }

        // Handle whisper mode
        if (config.mode === 'whisper') {
            if (!message.attachments.size) {
                await message.reply(SYS_PREFIX + 'Please send an audio message to receive a transcription, or switch modes (!help) to chat with a persona.');
            }
            return;
        }

        if (trigger === 'none') return;

        const channelId = message.channel.id;
        if (trigger === 'ambient') {
            this.ambient.recordHuman(channelId, message.author.id, config.sociability);
            const botId = message.client?.user?.id;
            const repliedToUs = channelHistory.isSelfId(message.mentions?.repliedUser?.id, botId);
            if (repliedToUs && message.reference?.messageId) {
                this.ambient.noteEngagement(channelId, message.reference.messageId);
            }
            if (repliedToUs || (botId && message.mentions?.users?.has(botId))) {
                this.directlyAddressed.add(channelId);
            }
        }

        // Wait for follow-up messages: each new one restarts the channel's timer.
        const existing = this.replyTimers.get(channelId);
        if (existing) clearTimeout(existing);

        const hasUrls = this.utils.hasURLs(message.content);
        const delay = hasUrls ? Math.max(config.responseDelayMs, 5000) : config.responseDelayMs;

        this.replyTimers.set(channelId, setTimeout(() => {
            this.replyTimers.delete(channelId);
            const direct = this.directlyAddressed.delete(channelId);
            if (trigger === 'reply' || direct) {
                this.sendDelayedResponse(message, isDM);
            } else {
                this.runAmbientGate(message, isDM).catch(error => console.error('❌ Ambient gate failed:', error));
            }
        }, delay));
    }

    /**
     * Ambient channels: after the conversation settles, ask Jev whether and how
     * to join in, and let the budget in chat/ambient.ts decide.
     */
    private async runAmbientGate(message: Message, isDM: boolean): Promise<void> {
        if (!isTypesafeConfigured()) {
            console.warn('⚠️ Ambient mode needs TYPESAFE_API_KEY; staying quiet.');
            return;
        }
        const id = isDM ? message.author.id : message.guild!.id;
        const config = this.state.getConfig(id, isDM);
        const channel = message.channel as TextChannel;
        const channelId = channel.id;
        const where = `#${channel.name ?? channelId}`;

        this.ambient.expire(channelId);
        const lines = await channelHistory.fetch(channel, { limit: GATE_HISTORY, since: config.contextResetAt });
        const latest = lines[lines.length - 1];
        if (!latest || latest.isSelf) return; // never speak twice running

        const judgment = await judgeConversation(lines, {
            mode: config.mode,
            channelName: channel.name,
            customEmoji: guildCustomEmoji(message.guild),
            recentEmoji: this.state.getRecentReactions(id, isDM).map(r => r.emoji)
        });
        if (judgment.respondsToJeeves >= RESPONDS_THRESHOLD) {
            this.ambient.noteEngagement(channelId);
        }

        // Reaction-mode channels already get a reaction on every message.
        const reactionsAllowed = !(config.reactionModeEnabled && config.reactionChannels.includes(channelId));
        const credit = this.ambient.credit(channelId);
        const decision = decide(judgment, { credit, sociability: config.sociability, reactionsAllowed });
        const shadow = config.ambientShadow ? ' [shadow]' : '';
        console.log(`🎲 Ambient ${where}${shadow}: ${decision.action} — ${decision.reason}; engagement ${this.ambient.engagement(channelId).toFixed(2)}`);

        if (decision.action === 'reply') {
            if (!decision.direct) this.ambient.spend(channelId, REPLY_COST);
            const target = lines.find(line => line.id === decision.targetId) ?? latest;
            await this.sendDelayedResponse(message, isDM, {
                ambient: { target, latestId: latest.id, unprompted: !decision.direct },
                shadow: config.ambientShadow
            });
        } else if (decision.action === 'react') {
            this.ambient.spend(channelId, REACT_COST);
            if (config.ambientShadow) {
                console.log(`👻 Would react ${decision.emoji} to ${latest.authorName}: "${snippet(latest.text)}"`);
                return;
            }
            try {
                const target = latest.id === message.id ? message : await channel.messages.fetch(latest.id);
                await target.react(decision.emoji);
                this.state.recordReaction(id, isDM, decision.emoji, latest.text, channelId);
            } catch (error) {
                console.error('Error adding ambient reaction:', error);
            }
        }
    }

    /** A reaction was added somewhere: count it if it's on one of our unprompted messages. */
    handleReactionAdded(channelId: string, messageId: string): void {
        if (this.ambient.isPending(channelId, messageId) && this.ambient.noteEngagement(channelId, messageId)) {
            console.log(`🙂 Engagement: reaction on our message in ${channelId}`);
        }
    }

    /**
     * A follow-up the agent planned (schedule_followup) has come due: ask the
     * person about it in the channel, in character.
     */
    async sendFollowup(reminder: ScheduledReminder, channel: TextChannel | DMChannel): Promise<void> {
        const id = reminder.isDM ? reminder.userId : (channel as TextChannel).guild.id;
        const config = this.state.getConfig(id, reminder.isDM);
        const prompt = {
            role: 'user',
            content: `[SYSTEM] Earlier you resolved to check in with <@${reminder.userId}> about ${reminder.followup!.about}. `
                + 'Now is the time: write a short, natural message asking them how it went (or how it is going), as a friend '
                + 'would. Stay in character. Do not mention reminders, notes, or that this was planned.'
        };
        const response = await this.generateResponse(id, reminder.isDM, [prompt], false, { channel });
        if (!response?.content) return;
        const chunks = this.utils.splitMessageIntoChunks([{ role: 'assistant', content: `<@${reminder.userId}> ${response.content}` }]);
        for (const chunk of chunks) {
            if (chunk) await this.utils.sendWebhookMessage(channel, chunk, config.mode);
        }
    }

    /**
     * Generate AI response.
     *
     * With `opts.channel`, the conversation is the channel's recent history
     * (since the persona's context floor); `additionalMessages` follow it.
     */
    async generateResponse(
        id: string,
        isDM: boolean,
        additionalMessages: { role: string; content: string }[] = [],
        isReminder = false,
        opts: GenerateOptions = {}
    ): Promise<(GeneratedResponse & { proposals: SettingProposal[] }) | null> {
        console.log(`🤖 Generating AI response for ${isDM ? 'user' : 'guild'}: ${id}`);

        const config = this.state.getConfig(id, isDM);
        const systemPrompt = this.getSystemPrompt(id, isDM);

        const lines = opts.channel
            ? await channelHistory.fetch(opts.channel, { limit: config.messageLimit, since: config.contextResetAt })
            : [];
        const latestMessages = [...toLlmMessages(lines), ...additionalMessages].filter(Boolean);
        if (!latestMessages.length) return null;

        const participants = new Map<string, ChatParticipant>();
        for (const line of lines) {
            if (!line.isSelf && !line.isBot) participants.set(line.authorId, { id: line.authorId, name: line.authorName });
        }

        console.log(`📚 Context size: ${latestMessages.length} messages (${lines.length} from channel history)`);

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

            enhancedSystemPrompt += this.describePeople(id, isDM, [...participants.values()]);

            const ambient = opts.ambient?.unprompted ? opts.ambient : undefined;
            if (ambient) {
                const words = medianWords(lines.filter(l => !l.isSelf).map(l => l.text));
                enhancedSystemPrompt += `\n\n[Joining in] Nobody addressed you: you are chiming in on the conversation as one of the regulars. `
                    + `Respond to ${ambient.target.authorName}'s message ("${snippet(ambient.target.text, 200)}"). `
                    + `Match the register of the chat — around ${Math.max(words, 8)} words, a line or two at most. `
                    + 'Add something (a fact, a correction, a joke) rather than summarising, agreeing, or offering further help. No sign-off.';
            }

            // Only a live chat reply can post the proposal buttons afterwards
            // (see sendDelayedResponse); muse/reminders just see the settings.
            const proposals: SettingProposal[] = [];
            const tools = [...AGENT_TOOLS];
            if (opts.allowProposals) tools.push(createProposeSettingTool(config, proposals));
            if (opts.allowProposals && opts.channel && participants.size) {
                tools.push(
                    createRememberTool(this.state, { id, isDM }, [...participants.values()]),
                    createFollowupTool(this.state, { id, isDM }, opts.channel.id, [...participants.values()])
                );
            }
            enhancedSystemPrompt += describeSettingsForAgent(config, !!opts.allowProposals);

            const result = await generateText(
                { anthropic: this.anthropic, xai: this.xai, poolside: this.poolside },
                {
                    model: config.model,
                    system: enhancedSystemPrompt,
                    messages: latestMessages
                        .map(msg => ({
                            role: msg?.role === 'assistant' ? 'assistant' : 'user',
                            content: msg?.content || ''
                        }))
                        .filter(m => Boolean(m.content)),
                    maxTokens: ambient ? Math.min(config.maxResponseLength, AMBIENT_MAX_TOKENS) : config.maxResponseLength,
                    temperature: config.temperature,
                    extendedThinking: config.extendedThinking,
                    webSearchEnabled: config.webSearchEnabled,
                    webSearchMaxUses: config.webSearchMaxUses,
                    tools
                }
            );

            if (result.content) {
                const finalContent = withSourcesFooter(result.content, result.sources);
                const response = { role: 'assistant', content: finalContent, proposals };
                const meta: string[] = [];
                if (config.extendedThinking) meta.push('thinking');
                if (result.searchesPerformed > 0) {
                    meta.push(`${result.searchesPerformed} web search${result.searchesPerformed === 1 ? '' : 'es'}`);
                }
                if (result.toolCalls > 0) {
                    meta.push(`${result.toolCalls} tool call${result.toolCalls === 1 ? '' : 's'}`);
                }
                const metaStr = meta.length ? ` [${meta.join(', ')}]` : '';
                console.log(`✅ Generated response (${response.content.length} chars) via ${config.model}${metaStr}`);
                return response;
            }
            return null;
        } catch (error: any) {
            // Transient API failures are already retried inside the SDK clients
            // (see maxRetries in server.ts); anything reaching here is final.
            console.error('❌ Error generating response:', error);
            throw error;
        }
    }

    /** What the agent has noted about the people in the conversation. */
    private describePeople(id: string, isDM: boolean, participants: ChatParticipant[]): string {
        const known = participants
            .map(p => ({ p, notes: this.state.getPersonNotes(id, isDM, p.id) }))
            .filter(({ notes }) => notes.length);
        if (!known.length) return '';
        const lines = known.map(({ p, notes }) =>
            `- ${p.name}: ${notes.map(n => `${n.text} (${dayjs(n.at).format('D MMM YYYY')})`).join('; ')}`);
        return `\n\n[What you remember about people here — use naturally, don't recite]\n${lines.join('\n')}`;
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
        // Web search is forced on for tasks (tools below), so force the
        // matching prompt addendum regardless of the channel's chat setting.
        const systemPrompt = this.getSystemPrompt(id, isDM, { webSearch: true });

        const taskFraming = `[SYSTEM] You are being invoked as a scheduled task. The user set this task in advance; they are not present to clarify. Carry out the following task and respond with your findings, in character. Do not break character to discuss the task framing.\n\n<task>\n${instructions}\n</task>`;

        const result = await generateText(
            { anthropic: this.anthropic, xai: this.xai, poolside: this.poolside },
            {
                model: config.model,
                system: systemPrompt?.content || '',
                messages: [{ role: 'user', content: taskFraming }],
                maxTokens: config.maxResponseLength,
                temperature: config.temperature,
                webSearchEnabled: true,
                webSearchMaxUses: TASK_AGENT_WEB_SEARCH_MAX_USES,
                tools: AGENT_TOOLS
            }
        );

        if (!result.content) return null;
        return {
            role: 'assistant',
            content: withSourcesFooter(result.content, result.sources)
        };
    }

    /**
     * Get system prompt for current mode.
     *
     * `opts.webSearch` overrides the channel's webSearchEnabled config for the
     * web-search addendum — runTask attaches the tool unconditionally, so it
     * must force the addendum on even when chat search is disabled.
     */
    getSystemPrompt(id: string, isDM: boolean, opts?: { webSearch?: boolean }): { role: string; content: string } | null {
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
            default: {
                const webSearch = opts?.webSearch ?? config.webSearchEnabled;
                const dateLine = `\nThe current date and time is ${dayjs().format('dddd, MMMM D, YYYY, HH:mm')}.\n`;
                return {
                    role: 'system',
                    content: JEEVES_PROMPT
                        + (isXaiModel(config.model) ? JEEVES_GROK_ADDENDUM : '')
                        + (webSearch ? WEB_SEARCH_ADDENDUM : '')
                        + dateLine
                };
            }
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

    private async sendDelayedResponse(
        message: Message,
        isDM: boolean,
        opts: { ambient?: AmbientReply; shadow?: boolean } = {}
    ): Promise<void> {
        const id = isDM ? message.author.id : message.guild!.id;
        const config = this.state.getConfig(id, isDM);
        const channel = message.channel;
        const ambient = opts.ambient;

        if (!isSendableChannel(channel)) {
            console.error('Channel does not support sending messages');
            return;
        }

        // Discord's typing indicator lapses after ~10s; an agent loop can run
        // for minutes, so keep it alive until the reply is ready.
        const typing = opts.shadow ? undefined : setInterval(() => channel.sendTyping().catch(() => {}), 8000);
        try {
            if (!opts.shadow) await channel.sendTyping();
            // Shadow runs get no proposal/notes/follow-up tools: they must leave no trace.
            const response = await this.generateResponse(id, isDM, [], false, {
                allowProposals: !opts.shadow, channel, ambient
            });
            if (!response) return;

            if (opts.shadow) {
                console.log(`👻 Would say (to ${ambient?.target.authorName}): ${response.content}`);
                return;
            }

            // Webhooks can't post Discord replies, so when answering something
            // other than the latest message, point at it.
            let content = response.content;
            if (ambient && ambient.target.id !== ambient.latestId) {
                content = `-# ↪ [${ambient.target.authorName.split('/').pop()}](${ambient.target.url})\n${content}`;
            }

            const chunks = this.utils.splitMessageIntoChunks(
                [{ role: response.role, content }],
                { maxChunkSize: 1800, spoiler: config.useVoiceResponse }
            );
            let firstSent: Message | null = null;

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
                    const files = i === 0 && audioFile ? [{ attachment: audioFile, name: 'response.mp3' }] : undefined;
                    const sent = await this.utils.sendWebhookMessage(message.channel, chunk, config.mode, files);
                    firstSent ??= sent;
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
                        const sent = await this.utils.sendWebhookMessage(message.channel, chunk, config.mode);
                        firstSent ??= sent;
                    }
                }
            }

            if (ambient?.unprompted && firstSent) {
                this.ambient.recordUnprompted(channel.id, firstSent.id);
            }

            for (const proposal of response.proposals) {
                await channel.send(buildProposalMessage(proposal, config.mode));
            }
        } catch (error) {
            console.error('Error sending delayed response:', error);
            // Nobody asked for an unprompted remark, so don't announce its failure.
            if (!ambient?.unprompted) {
                await message.reply(`${SYS_PREFIX}[ERROR] Failed to generate response.`);
            }
        } finally {
            if (typing) clearInterval(typing);
        }
    }

    private async triggerLearningQuestion(message: Message, id: string, isDM: boolean): Promise<void> {
        const config = this.state.getConfig(id, isDM);

        if (!config.learningEnabled) {
            await message.reply(`${SYS_PREFIX}Learning questions are disabled. Turn on **Learning** in \`/settings\` (Features tab).`);
            return;
        }

        if (config.learningSubjects.length === 0) {
            await message.reply(`${SYS_PREFIX}No learning subjects configured. Add some with \`/learning subject:<subject>\`.`);
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

            const result = await whisper(safePath, speedScalar);

            if (result.error) {
                console.error(`❌ Transcription error: ${result.error}`);
                const replyText = SYS_PREFIX + `[ERROR] ${result.error}`;
                await message.reply(replyText.length > 1900 ? replyText.slice(0, 1900) + '…' : replyText);
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
                if (chunk && isSendableChannel(channel)) {
                    // The transcript is annotated onto the voice message itself;
                    // don't let the posted copy read as the bot talking.
                    const sent = await channel.send(chunk);
                    if (sent?.id) channelHistory.hide(sent.id);
                }
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
