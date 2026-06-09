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
 * Discord slash-command option types we support. Maps to a subset of
 * ApplicationCommandOptionType; the bridge in commands/slash.ts converts these
 * to discord.js builders and back into the `string[]` args legacy handlers expect.
 */
export type CommandOptionType =
    | 'string'
    | 'integer'
    | 'number'
    | 'boolean'
    | 'channel'
    | 'user';

/**
 * Declarative description of one command argument. Drives BOTH the generated
 * help text and the Discord slash-command registration, so the two can never
 * drift apart again.
 */
export interface CommandOption {
    /** Option name (slash requires lowercase, no spaces, 1-32 chars). */
    name: string;
    /** Shown in the slash UI and in `!help <cmd>`. */
    description: string;
    type: CommandOptionType;
    /** Defaults to false (optional). */
    required?: boolean;
    /** Fixed set of allowed values (string/integer/number options only). */
    choices?: { name: string; value: string }[];
    /**
     * When true, the legacy `!cmd ...` parser splits this option's value on
     * whitespace into multiple arg tokens, so handlers that read
     * `args.slice(n).join(' ')` reconstruct the full phrase. Only valid on the
     * final option. In the slash path it is just a normal single string option.
     */
    rest?: boolean;
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

    // ── Metadata (single source of truth for help + slash registration) ──

    /** One-line summary. Shown in `!help` and as the slash-command description. */
    description?: string;
    /** Help section grouping, e.g. 'Modes', 'Configuration', 'Tasks'. */
    category?: string;
    /** Argument schema. Generates slash options and (unless `usage` is set) the usage string. */
    options?: CommandOption[];
    /** Explicit usage string for help; if omitted it is derived from `options`. */
    usage?: string;
    /** Example invocations, shown in the per-command help detail view. */
    examples?: string[];
    /**
     * Exclude from Discord slash registration (e.g. operator-only or
     * voice-only commands). May still appear in `!help`. Default: included.
     */
    slashExclude?: boolean;
    /** Omit from the `!help` listing (operator-only / internal commands). */
    hidden?: boolean;
    /**
     * Reply ephemerally on the slash path (only the invoker sees it, and it
     * auto-dismisses) — used for config/toggle confirmations that would
     * otherwise clutter the channel. No effect on the legacy `!text` path,
     * where ephemeral replies don't exist.
     */
    ephemeral?: boolean;
    /**
     * Set for commands that call the AI / do slow I/O. The slash handler defers
     * the interaction reply so it doesn't blow Discord's 3-second ack deadline.
     */
    deferred?: boolean;
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
