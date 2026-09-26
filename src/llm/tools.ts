/**
 * Client-side tools available to the persona agents (see the agent loop in
 * generate.ts). Add a tool here and include it in AGENT_TOOLS to expose it to
 * chat and scheduled tasks on every provider.
 */

import { LlmTool } from './generate';
import { getWebpage } from '../getWebpage';
import { BotConfig, BotState } from '../state';
import {
    PROPOSABLE_SETTINGS, SettingProposal, describeChange, describeRange, displayNumber, formatSetting,
    getSetting, parseSettingValue
} from '../settings/schema';

export const fetchWebpageTool: LlmTool = {
    name: 'fetch_webpage',
    description:
        'Load a web page in a real headless browser (JavaScript runs) and return its ' +
        'title, final URL and the visible text of its main content (navigation and ' +
        'site chrome removed; long pages are truncated and say so). Use it to read a ' +
        'specific URL — one the user shared or one found via search — when a snippet ' +
        'is not enough.',
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Absolute URL to load.' }
        },
        required: ['url']
    },
    run: async ({ url }: { url: string }) => getWebpage(url)
};

export const AGENT_TOOLS: LlmTool[] = [fetchWebpageTool];

/**
 * Lets the agent suggest a change to one of its own settings. Nothing changes
 * here: the proposal is collected into `proposals` and the caller posts it
 * after the reply with Apply / Not now buttons (settings/panel.ts). At most
 * one per reply. Built per generation, since it checks the current config.
 */
export function createProposeSettingTool(config: BotConfig, proposals: SettingProposal[]): LlmTool {
    const options = PROPOSABLE_SETTINGS.map(s => s.kind === 'toggle'
        ? `${s.key} (${s.label}: on/off; now ${formatSetting(s, config)})`
        : `${s.key} (${s.label}: ${describeRange(s)}${s.unit ? ` ${s.unit}` : ''}; now ${formatSetting(s, config)})`);
    return {
        name: 'propose_setting_change',
        description:
            'Suggest that the user change one of your bot settings. Nothing changes unless a person clicks ' +
            'Apply on the suggestion, which is posted after your reply; it takes effect from their next ' +
            'message. At most one suggestion per reply. Settings you may suggest: ' + options.join('; ') + '.',
        parameters: {
            type: 'object',
            properties: {
                setting: { type: 'string', enum: PROPOSABLE_SETTINGS.map(s => s.key), description: 'Which setting.' },
                value: { type: 'string', description: '"on"/"off" for switches, or a number in the listed units.' },
                reason: { type: 'string', description: 'One short sentence, in character, telling the user why.' }
            },
            required: ['setting', 'value', 'reason']
        },
        run: async ({ setting: key, value, reason }: { setting: string; value: unknown; reason: string }) => {
            if (proposals.length) throw new Error('Only one suggestion per reply, and one is already queued.');
            const setting = getSetting(key);
            if (!setting?.proposable) throw new Error(`Not a setting you may suggest: ${key}`);
            const parsed = parseSettingValue(setting, value);
            if (!parsed.ok) throw new Error(parsed.error);
            if (parsed.value === config[setting.key]) {
                return `${setting.label} is already ${formatSetting(setting, config)}; nothing to suggest.`;
            }
            const display = setting.kind === 'toggle' ? parsed.value : displayNumber(setting, parsed.value as number);
            proposals.push({ key: setting.key, value: display, reason: String(reason ?? '').trim() || 'It may serve you better.' });
            return `Queued: the user will be offered to ${describeChange(setting, display).replace(/\*\*/g, '')}, ` +
                'with Apply / Not now buttons, right after your reply. Do not claim it is already changed.';
        }
    };
}

/** Someone in the current chat, as the agent sees them ("username/Display Name"). */
export interface ChatParticipant {
    id: string;
    name: string;
}

const MAX_FOLLOWUP_HOURS = 24 * 60;
const MAX_PENDING_FOLLOWUPS_PER_PERSON = 3;

/** Match the name the model used against the people in the chat. */
export function resolveParticipant(participants: ChatParticipant[], who: string): ChatParticipant | undefined {
    const wanted = String(who ?? '').trim().replace(/^@/, '').toLowerCase();
    if (!wanted) return undefined;
    return participants.find(p => {
        const [username, display] = p.name.toLowerCase().split('/');
        return wanted === p.name.toLowerCase() || wanted === username || wanted === display;
    });
}

function unknownPerson(participants: ChatParticipant[], who: string): Error {
    const names = participants.map(p => p.name.split('/')[0]).join(', ') || 'nobody';
    return new Error(`No one called "${who}" in the recent conversation. People here: ${names}.`);
}

/**
 * Lets the agent note a lasting fact about someone in the chat. Notes are
 * shown to it whenever that person is in the conversation, and each person
 * can see and delete what's noted about them with /notes.
 */
export function createRememberTool(
    state: BotState, scope: { id: string; isDM: boolean }, participants: ChatParticipant[]
): LlmTool {
    return {
        name: 'remember_about_person',
        description:
            'Quietly note a lasting fact about someone in this chat that a friend would remember next time: ' +
            'their work or studies, interests, plans, family, pets, what they are going through. Only what they ' +
            'shared openly here, and nothing sensitive (health, money, secrets) unless they plainly want it ' +
            'remembered. Your notes about people are shown to you whenever they are in the conversation, and ' +
            'they can view or delete them with /notes. Do not remark that you are taking a note.',
        parameters: {
            type: 'object',
            properties: {
                person: { type: 'string', description: 'Their username as shown in the chat.' },
                fact: { type: 'string', description: 'One short sentence, e.g. "Has a viva on 3 October in medieval history."' }
            },
            required: ['person', 'fact']
        },
        run: async ({ person, fact }: { person: string; fact: string }) => {
            const who = resolveParticipant(participants, person);
            if (!who) throw unknownPerson(participants, person);
            if (!String(fact ?? '').trim()) throw new Error('The fact is empty.');
            state.addPersonNote(scope.id, scope.isDM, who.id, who.name, fact);
            return `Noted about ${who.name}.`;
        }
    };
}

/**
 * Lets the agent plan to check in with someone later ("how did the viva
 * go?"). Stored as a reminder for that person — so it shows in their
 * /reminders and they can cancel it — which fires as an in-character
 * question in this channel instead of a plain reminder.
 */
export function createFollowupTool(
    state: BotState, scope: { id: string; isDM: boolean }, channelId: string, participants: ChatParticipant[]
): LlmTool {
    return {
        name: 'schedule_followup',
        description:
            'Plan to check in with someone later about something they mentioned — an exam, an interview, a trip, ' +
            'a problem they were wrestling with — the way a friend asks "how did it go?". When the time comes you ' +
            'will be prompted to ask them about it in this channel. Use sparingly, only for things they would be ' +
            'glad to be asked about, and time it for just after the event.',
        parameters: {
            type: 'object',
            properties: {
                person: { type: 'string', description: 'Their username as shown in the chat.' },
                about: { type: 'string', description: 'What to ask about, e.g. "their viva in medieval history".' },
                hours_from_now: { type: 'number', description: `When to ask, in hours from now (up to ${MAX_FOLLOWUP_HOURS}).` }
            },
            required: ['person', 'about', 'hours_from_now']
        },
        run: async ({ person, about, hours_from_now }: { person: string; about: string; hours_from_now: number }) => {
            const who = resolveParticipant(participants, person);
            if (!who) throw unknownPerson(participants, person);
            const hours = Number(hours_from_now);
            if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_FOLLOWUP_HOURS) {
                throw new Error(`hours_from_now must be between 0 and ${MAX_FOLLOWUP_HOURS}.`);
            }
            const topic = String(about ?? '').trim().slice(0, 200);
            if (!topic) throw new Error('Say what to ask about.');
            const pending = state.getRemindersForUser(who.id).filter(r => r.followup).length;
            if (pending >= MAX_PENDING_FOLLOWUPS_PER_PERSON) {
                throw new Error(`${who.name} already has ${pending} follow-ups planned; that is plenty.`);
            }
            const triggerTime = new Date(Date.now() + hours * 60 * 60 * 1000);
            state.addReminder({
                id: `${who.id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                userId: who.id,
                channelId,
                content: `Follow-up: ${topic}`,
                triggerTime,
                isDM: scope.isDM,
                followup: { about: topic }
            });
            return `Planned: you will ask ${who.name} about ${topic} at ${triggerTime.toISOString()}.`;
        }
    };
}
