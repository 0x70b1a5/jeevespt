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

// Model cache
export const MODEL_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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
