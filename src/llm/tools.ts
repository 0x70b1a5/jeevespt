/**
 * Client-side tools available to the persona agents (see the agent loop in
 * generate.ts). Add a tool here and include it in AGENT_TOOLS to expose it to
 * chat and scheduled tasks on every provider.
 */

import { LlmTool } from './generate';
import { getWebpage } from '../getWebpage';

export const fetchWebpageTool: LlmTool = {
    name: 'fetch_webpage',
    description:
        'Load a web page in a headless browser and return its title and visible text ' +
        '(truncated to ~4000 characters). Use it to read a specific URL — one the user ' +
        'shared or one found via search — when a snippet is not enough.',
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
