/**
 * Client-side tools available to the persona agents (see the agent loop in
 * generate.ts). Add a tool here and include it in AGENT_TOOLS to expose it to
 * chat and scheduled tasks on every provider.
 */

import { LlmTool } from './generate';
import { getWebpage } from '../getWebpage';
import { BotConfig } from '../state';
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
