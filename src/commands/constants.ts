// Security constants for file downloads
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
export const ALLOWED_DOMAINS = ['cdn.discordapp.com', 'media.discordapp.net'];
export const TEMP_DIR = './temp';

// Response/retry configuration
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000;
export const MAX_CHUNK_SIZE = 1800;

// Reminder limits
export const MIN_REMINDER_MS = 10000; // 10 seconds
export const MAX_REMINDER_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

// Task agent settings
export const MAX_TASK_FAILURES = 2; // pause + notify after this many consecutive failed runs
export const TASK_PARSER_MODEL = 'claude-haiku-4-5-20251001';
export const TASK_AGENT_WEB_SEARCH_MAX_USES = 8;

// Model cache
export const MODEL_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Whether the given Anthropic model accepts the `temperature` parameter.
 *
 * Anthropic removed the sampling parameters (`temperature`, `top_p`, `top_k`)
 * on its frontier models; sending `temperature` to one that dropped it returns
 * a 400. The models that do NOT accept it:
 *   • Fable 5 and any later Fable tier  (`claude-fable-*`)
 *   • Opus 4.7 and later                (`claude-opus-4-7`, `-4-8`, … and Opus 5+)
 * Everything else still accepts it: Opus 4.6 and earlier, every Sonnet, every
 * Haiku. New Sonnet/Haiku releases are assumed to keep it — revisit this when a
 * new top-tier family launches.
 *
 * (The Models API capability tree doesn't expose sampling support, so this
 * can't be derived from `GET /v1/models` — it has to be encoded here.)
 *
 * Parsing note: an Opus id is `claude-opus-<major>-<minor>`, optionally with a
 * `-<date>` snapshot suffix (e.g. `claude-opus-4-8-20260101`). The bare
 * `claude-opus-4-20250514` is Opus *4.0* with a date suffix — `20250514` is the
 * date, not minor version 20250514 — so the minor is constrained to one or two
 * digits and a long date segment is correctly read as "no minor" (i.e. 4.0).
 */
export function modelSupportsTemperature(model: string): boolean {
    // Fable tier (current and future) removed the sampling params.
    if (/^claude-fable-/.test(model)) return false;

    // Opus removed them at 4.7; applies to 4.7+ and any future Opus 5+.
    const opus = /^claude-opus-(\d{1,2})(?:-(\d{1,2}))?(?:$|-)/.exec(model);
    if (opus) {
        const major = Number(opus[1]);
        const minor = opus[2] === undefined ? 0 : Number(opus[2]);
        if (major > 4 || (major === 4 && minor >= 7)) return false;
    }

    return true;
}

// System message prefix
export const SYS_PREFIX = '[SYSTEM] ';

// Time multipliers for reminder parsing
export const TIME_MULTIPLIERS = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000
} as const;

// Persona configurations for different modes
export interface PersonaConfig {
    name: string;
    avatar: string;
}

export const PERSONAS: Record<string, PersonaConfig> = {
    jeeves: {
        name: 'Jeeves',
        avatar: 'https://lovecrypt.nyc3.cdn.digitaloceanspaces.com/jeeves.jpeg'
    },
    tokipona: {
        name: 'jan pona',
        avatar: 'https://lovecrypt.nyc3.cdn.digitaloceanspaces.com/mumumu.png'
    },
    whisper: {
        name: 'Whisper Bot',
        avatar: 'https://lovecrypt.nyc3.cdn.digitaloceanspaces.com/Grand%20Mask.png'
    },
    customprompt: {
        name: 'Custom Bot',
        avatar: 'https://lovecrypt.nyc3.cdn.digitaloceanspaces.com/Grand%20Mask.png'
    },
    lugso: {
        name: '5ub-sot',
        avatar: 'https://nuga.theologi.ca/processed_images/futnu-voso.d5e2d346e7e6c204.png'
    }
};

// Mode switch responses
export const MODE_RESPONSES: Record<string, string> = {
    jeeves: 'I have switched to Jeeves mode, sir.',
    tokipona: 'mi ante e nasin tawa toki pona.',
    whisper: 'Switched to transcription mode.',
    lugso: 'rvi zodnyo ugonogl5ix unso rliyo5ix fhtogn xtulhu'
};
