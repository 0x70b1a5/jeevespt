import { Message, TextChannel, DMChannel, Webhook, Collection } from 'discord.js';
import { BotState } from '../bot';
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { ElevenLabs } from '../elevenlabs';

/**
 * Context passed to all command handlers
 */
export interface CommandContext {
    message: Message;
    id: string;
    isDM: boolean;
    args: string[];
}

/**
 * Dependencies injected into command handlers
 */
export interface CommandDependencies {
    state: BotState;
    openai: OpenAI;
    anthropic: Anthropic;
    elevenLabs: ElevenLabs;
}

/**
 * Interface for a command handler
 */
export interface Command {
    /** Command name(s) that trigger this handler */
    names: string[];
    /** Execute the command */
    execute(ctx: CommandContext, deps: CommandDependencies): Promise<void>;
    /** Optional: Whether command requires guild (not DM) */
    requiresGuild?: boolean;
}

/**
 * Shared utilities interface for command handlers
 */
export interface CommandUtils {
    /** Send a system message */
    reply(message: Message, content: string): Promise<void>;
    /** Send an error message */
    replyError(message: Message, error: string): Promise<void>;
    /** Split content into Discord-safe chunks */
    splitMessageIntoChunks(msgs: { role: string; content: string }[], opts?: ChunkOptions): string[];
    /** Get channel ID from name */
    getChannelIdFromName(message: Message, channelName: string): string | null;
    /** Send message via webhook with persona */
    sendWebhookMessage(channel: TextChannel | DMChannel, content: string, mode: string, files?: any[]): Promise<void>;
    /** Get or create webhook for channel */
    getWebhookForChannel(channel: TextChannel, mode: string): Promise<Webhook | null>;
}

export interface ChunkOptions {
    maxChunkSize?: number;
    spoiler?: boolean;
}

/**
 * Result from generating a response
 */
export interface GeneratedResponse {
    role: string;
    content: string;
}
