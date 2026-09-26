/**
 * Commands folded into /settings or into a single list command. Typing an old
 * name gets a pointer to where it went instead of "Unrecognized command".
 */

const SETTINGS_CHAT = '`/settings` → Chat tab';
const SETTINGS_FEATURES = '`/settings` → Features tab';
const SETTINGS_ADMIN = '`/settings` → Admin tab';
const PERSONA = '`/settings` → Chat tab → Persona menu';

export const RETIRED_COMMANDS: Record<string, string> = {
    // Settings → /settings
    websearchon: `${SETTINGS_CHAT} (Web search)`,
    websearchoff: `${SETTINGS_CHAT} (Web search)`,
    searchon: `${SETTINGS_CHAT} (Web search)`,
    searchoff: `${SETTINGS_CHAT} (Web search)`,
    thinkon: `${SETTINGS_CHAT} (Extended thinking)`,
    thinkoff: `${SETTINGS_CHAT} (Extended thinking)`,
    temperature: `${SETTINGS_CHAT} → Numbers… (Temperature)`,
    tokens: `${SETTINGS_CHAT} → Numbers… (Max response)`,
    limit: `${SETTINGS_CHAT} → Numbers… (Memory)`,
    delay: `${SETTINGS_CHAT} → Numbers… (Response delay)`,
    websearchmax: `${SETTINGS_CHAT} → Numbers… (Searches per reply)`,
    searchmax: `${SETTINGS_CHAT} → Numbers… (Searches per reply)`,
    voiceon: `${SETTINGS_FEATURES} (Voice replies)`,
    voiceoff: `${SETTINGS_FEATURES} (Voice replies)`,
    museon: `${SETTINGS_FEATURES} (Auto-muse)`,
    museoff: `${SETTINGS_FEATURES} (Auto-muse)`,
    museinterval: `${SETTINGS_FEATURES} → Numbers… (Muse interval)`,
    reacton: `${SETTINGS_FEATURES} (Reactions)`,
    reactoff: `${SETTINGS_FEATURES} (Reactions)`,
    learnon: `${SETTINGS_FEATURES} (Learning)`,
    learnoff: `${SETTINGS_FEATURES} (Learning)`,
    speedscalar: `${SETTINGS_FEATURES} → Numbers… (Transcription speed)`,
    persist: `${SETTINGS_ADMIN} (Save to disk)`,
    dms: `${SETTINGS_ADMIN} (Direct messages)`,
    adminmode: `${SETTINGS_ADMIN} (Admin mode)`,
    jeeves: PERSONA,
    tokipona: PERSONA,
    lugso: PERSONA,
    whisper: PERSONA,

    // Lists → one command each, with ❌ buttons to remove
    cancelreminder: '`/reminders`, then click ❌ next to the reminder',
    canceltask: '`/tasks`, then click ❌ next to the task',
    translateadd: '`/translate channel:#channel language:Spanish`',
    translateadduser: '`/translate user:@name language:Latin`',
    translateremove: '`/translate`, then click ❌ next to the entry',
    translateremoveuser: '`/translate`, then click ❌ next to the entry',
    translatelist: '`/translate`',
    translatelistusers: '`/translate`',
    learnadd: '`/learning subject:Latin`',
    learnremove: '`/learning`, then click ❌ next to the subject',
    learnstatus: '`/learning`',
    reactadd: '`/reactchannels channel:#channel`',
    reactremove: '`/reactchannels`, then click ❌ next to the channel',
    unwhitelist: '`/whitelist`, then click ❌ next to the command',
    showwhitelist: '`/whitelist`'
};
