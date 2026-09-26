/**
 * The settings table — single source of truth for every simple on/off and
 * numeric BotConfig setting. It drives:
 *   • the `/settings` panel (settings/panel.ts)
 *   • the generated `!thinkon`, `!tokens 500`, … commands (commands/settings.ts)
 *   • what agents are told about their settings, and which ones they may
 *     propose changing (llm/tools.ts)
 *
 * Persona (mode) and model are pick-one settings with bespoke commands
 * (`!jeeves`, `!model`), so they live outside this table; the panel handles
 * them with dropdowns via applyMode / the model list.
 */

import { BotConfig, BotMode, BotState } from '../state';

export type SettingTab = 'chat' | 'features' | 'admin';

type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];

interface SettingBase {
    label: string;
    emoji: string;
    /** One line: what it does. Shown in help, the panel, and to agents. */
    description: string;
    tab: SettingTab;
    /** `!help` section for the generated commands. */
    category: string;
    /** Meaningless in DMs (hidden from the DM panel; commands require a guild). */
    guildOnly?: boolean;
    /** Only server administrators may change it, even with admin mode off. */
    requiresAdmin?: boolean;
    /** Agents may suggest changing it (a human must still approve). */
    proposable?: boolean;
}

export interface ToggleSetting extends SettingBase {
    kind: 'toggle';
    key: KeysOfType<BotConfig, boolean>;
    /** Generated command names. `toggle` flips; `on`/`off` set explicitly. */
    commands?: { on?: string[]; off?: string[]; toggle?: string[] };
}

export interface NumberSetting extends SettingBase {
    kind: 'number';
    key: KeysOfType<BotConfig, number>;
    min: number;
    /** When true, `min` itself is not allowed (value must be greater). */
    minExclusive?: boolean;
    max?: number;
    integer?: boolean;
    /** Round user input to the nearest whole unit before validating. */
    round?: boolean;
    /** Stored value = displayed value × scale (e.g. seconds → ms). */
    scale?: number;
    /** Plural unit shown after the value, e.g. "seconds". */
    unit?: string;
    command?: { names: string[]; option: { name: string; description: string } };
}

export type Setting = ToggleSetting | NumberSetting;

export const SETTINGS: Setting[] = [
    // ── Chat ────────────────────────────────────────────────────────────
    {
        kind: 'toggle', key: 'webSearchEnabled', label: 'Web search', emoji: '🔍', tab: 'chat',
        category: 'Configuration', proposable: true,
        description: 'Let the bot search the internet when answering.',
        commands: { on: ['websearchon', 'searchon'], off: ['websearchoff', 'searchoff'] }
    },
    {
        kind: 'toggle', key: 'extendedThinking', label: 'Extended thinking', emoji: '🧠', tab: 'chat',
        category: 'Configuration', proposable: true,
        description: 'Think before answering (+3000 thinking tokens; slower, more careful).',
        commands: { on: ['thinkon'], off: ['thinkoff'] }
    },
    {
        kind: 'number', key: 'temperature', label: 'Temperature', emoji: '🌡️', tab: 'chat',
        category: 'Configuration',
        description: 'Sampling randomness; higher is more adventurous.',
        min: 0, minExclusive: true, max: 2,
        command: { names: ['temperature'], option: { name: 'value', description: 'Temperature between 0 and 2' } }
    },
    {
        kind: 'number', key: 'maxResponseLength', label: 'Max response', emoji: '📏', tab: 'chat',
        category: 'Configuration', proposable: true,
        description: 'Maximum tokens per reply.',
        min: 1, max: 32000, integer: true, unit: 'tokens',
        command: { names: ['tokens'], option: { name: 'tokens', description: 'Max tokens (1–32000)' } }
    },
    {
        kind: 'number', key: 'messageLimit', label: 'Memory', emoji: '📚', tab: 'chat',
        category: 'Chat History',
        description: 'How many past messages the bot remembers.',
        min: 1, max: 1000, integer: true, unit: 'messages',
        command: { names: ['limit'], option: { name: 'count', description: 'Number of messages to remember' } }
    },
    {
        kind: 'number', key: 'responseDelayMs', label: 'Response delay', emoji: '⏳', tab: 'chat',
        category: 'Configuration',
        description: 'How long to wait for follow-up messages before replying.',
        min: 1, max: 600, integer: true, round: true, scale: 1000, unit: 'seconds',
        command: { names: ['delay'], option: { name: 'seconds', description: 'Delay in seconds' } }
    },
    {
        kind: 'number', key: 'webSearchMaxUses', label: 'Searches per reply', emoji: '🔢', tab: 'chat',
        category: 'Configuration', proposable: true,
        description: 'Cap on web searches per reply.',
        min: 1, max: 20, integer: true, unit: 'searches',
        command: { names: ['websearchmax', 'searchmax'], option: { name: 'count', description: 'Max searches per response (1–20)' } }
    },

    // ── Features ────────────────────────────────────────────────────────
    {
        kind: 'toggle', key: 'useVoiceResponse', label: 'Voice replies', emoji: '🔊', tab: 'features',
        category: 'Configuration', proposable: true,
        description: 'Attach spoken audio to replies.',
        commands: { on: ['voiceon'], off: ['voiceoff'] }
    },
    {
        kind: 'toggle', key: 'shouldMuseRegularly', label: 'Auto-muse', emoji: '🎭', tab: 'features',
        category: 'Musing',
        description: 'Periodically muse on a web page when the chat is quiet.',
        commands: { on: ['museon'], off: ['museoff'] }
    },
    {
        kind: 'toggle', key: 'reactionModeEnabled', label: 'Reactions', emoji: '😀', tab: 'features',
        category: 'Reactions', guildOnly: true,
        description: 'React to messages with emoji in monitored channels.',
        commands: { on: ['reacton'], off: ['reactoff'] }
    },
    {
        kind: 'toggle', key: 'learningEnabled', label: 'Learning', emoji: '🎓', tab: 'features',
        category: 'Learning',
        description: 'Ask spaced-repetition learning questions.',
        commands: { on: ['learnon'], off: ['learnoff'] }
    },
    {
        kind: 'number', key: 'museInterval', label: 'Muse interval', emoji: '⏰', tab: 'features',
        category: 'Musing',
        description: 'Hours of quiet before an automatic muse.',
        min: 0, minExclusive: true, max: 24 * 30, scale: 60 * 60 * 1000, unit: 'hours',
        command: { names: ['museinterval'], option: { name: 'hours', description: 'Hours between automatic muses' } }
    },
    {
        kind: 'number', key: 'transcriptionSpeedScalar', label: 'Transcription speed', emoji: '⏩', tab: 'features',
        category: 'Configuration',
        description: 'Speed audio up by this factor before transcribing.',
        min: 0.5, max: 4,
        command: { names: ['speedscalar'], option: { name: 'scalar', description: 'Speed scalar between 0.5 and 4.0' } }
    },

    // ── Admin ───────────────────────────────────────────────────────────
    {
        kind: 'toggle', key: 'shouldSaveData', label: 'Save to disk', emoji: '💾', tab: 'admin',
        category: 'Configuration',
        description: 'Persist settings and history between restarts.',
        commands: { toggle: ['persist'] }
    },
    {
        kind: 'toggle', key: 'allowDMs', label: 'Direct messages', emoji: '📨', tab: 'admin',
        category: 'Configuration',
        description: 'Respond to direct messages.',
        commands: { toggle: ['dms'] }
    },
    {
        // Command stays hand-written (!adminmode) for its whitelist guidance.
        kind: 'toggle', key: 'adminMode', label: 'Admin mode', emoji: '🛡️', tab: 'admin',
        category: 'Admin', guildOnly: true, requiresAdmin: true,
        description: 'Only administrators may run commands or change settings.'
    }
];

export function getSetting(key: string): Setting | undefined {
    return SETTINGS.find(s => s.key === key);
}

export function settingsForTab(tab: SettingTab, isDM: boolean): Setting[] {
    return SETTINGS.filter(s => s.tab === tab && !(isDM && s.guildOnly));
}

/** The value as a person reads it ("on", "5 seconds"). */
export function formatSetting(setting: Setting, config: BotConfig): string {
    if (setting.kind === 'toggle') return config[setting.key] ? 'on' : 'off';
    const shown = displayNumber(setting, config[setting.key]);
    return setting.unit ? `${shown} ${setting.unit}` : String(shown);
}

/** Stored → displayed number (e.g. 5000 ms → 5). */
export function displayNumber(setting: NumberSetting, stored: number): number {
    return Number((stored / (setting.scale ?? 1)).toFixed(4));
}

/** Human-readable allowed range, e.g. "between 0.5 and 4", "an integer from 1 to 20". */
export function describeRange(setting: NumberSetting): string {
    const kind = setting.integer ? 'a whole number' : 'a number';
    const low = setting.minExclusive ? `greater than ${setting.min}` : `at least ${setting.min}`;
    if (setting.max === undefined) return `${kind} ${low}`;
    return setting.minExclusive
        ? `${kind} greater than ${setting.min} and at most ${setting.max}`
        : `${kind} from ${setting.min} to ${setting.max}`;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Parse user/agent input into the value to store. Numbers are given in
 * display units ("5" seconds) and come back scaled (5000 ms).
 */
export function parseSettingValue(setting: Setting, raw: unknown): ParseResult<boolean | number> {
    if (setting.kind === 'toggle') {
        const text = String(raw).trim().toLowerCase();
        if (raw === true || ['on', 'true', 'yes', 'enable', 'enabled', '1'].includes(text)) return { ok: true, value: true };
        if (raw === false || ['off', 'false', 'no', 'disable', 'disabled', '0'].includes(text)) return { ok: true, value: false };
        return { ok: false, error: `${setting.label} must be on or off.` };
    }

    let n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (setting.round && Number.isFinite(n)) n = Math.round(n);
    const tooLow = setting.minExclusive ? n <= setting.min : n < setting.min;
    if (
        String(raw).trim() === '' || !Number.isFinite(n) || tooLow ||
        (setting.max !== undefined && n > setting.max) ||
        (setting.integer && !Number.isInteger(n))
    ) {
        return { ok: false, error: `${setting.label} must be ${describeRange(setting)}.` };
    }
    return { ok: true, value: n * (setting.scale ?? 1) };
}

export function applySetting(state: BotState, id: string, isDM: boolean, setting: Setting, value: boolean | number): void {
    state.updateConfig(id, isDM, { [setting.key]: value } as Partial<BotConfig>);
}

/** Switch persona. Clears memory, as the mode commands always have. */
export function applyMode(state: BotState, id: string, isDM: boolean, mode: BotMode): void {
    state.getLog(id, isDM).messages = [];
    state.updateConfig(id, isDM, { mode });
}

export const PROPOSABLE_SETTINGS = SETTINGS.filter(s => s.proposable);

/** An agent's suggested change, awaiting a person's Apply click. */
export interface SettingProposal {
    key: string;
    /** In display units (seconds, not ms), already validated. */
    value: boolean | number;
    reason: string;
}

/** "turn 🔍 **Web search** on" / "set 📏 **Max response** to 4000 tokens" */
export function describeChange(setting: Setting, value: boolean | number): string {
    if (setting.kind === 'toggle') return `turn ${setting.emoji} **${setting.label}** ${value ? 'on' : 'off'}`;
    return `set ${setting.emoji} **${setting.label}** to ${value}${setting.unit ? ` ${setting.unit}` : ''}`;
}

/**
 * A short settings briefing for the system prompt, so the agent knows its own
 * configuration (and can tell when a different one would serve the user).
 */
export function describeSettingsForAgent(config: BotConfig, canPropose: boolean): string {
    const current = SETTINGS
        .filter(s => s.tab === 'chat' || s.proposable)
        .map(s => `${s.label}: ${formatSetting(s, config)}`)
        .join('; ');
    let text = `\n\n[Your current bot settings] Model: ${config.model}; ${current}.`;
    if (canPropose) {
        text += ' If a different setting would genuinely serve the user better (for example web search for current events, '
            + 'or a longer reply limit for a detailed request), you may suggest it with the propose_setting_change tool. '
            + 'A person must approve it with a button, and it takes effect from their next message — so answer as best you '
            + 'can now, and mention the suggestion briefly, in character. Use the tool rather than asking the user to change '
            + 'settings themselves — it gives them a one-click button. Do not suggest changes the user did not need.';
    }
    return text;
}
