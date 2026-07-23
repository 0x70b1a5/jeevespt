/**
 * Multi-provider LLM generation (Anthropic Claude + xAI Grok + Hermes/Nous).
 *
 * Routes by model id: `grok-*` → xAI Responses API; `hermes-*`, `poolside/*`, `nous/*` → Hermes/Nous API;
 * everything else → Anthropic.
 */

import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { MessageParam } from '@anthropic-ai/sdk/resources';
import { isXaiModel, isHermesModel } from '../state/types';
import { modelSupportsTemperature } from '../commands/constants';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface GenerateOptions {
    model: string;
    system?: string;
    messages: { role: string; content: string }[];
    maxTokens: number;
    temperature?: number;
    /** Anthropic extended thinking; no-op on xAI (Grok reasons natively). */
    extendedThinking?: boolean;
    webSearchEnabled?: boolean;
    webSearchMaxUses?: number;
}

export interface GenerateResult {
    content: string | null;
    sources: Map<string, string>;
    searchesPerformed: number;
}

export interface LlmClients {
    anthropic: Anthropic;
    xai: OpenAI;
    hermes?: OpenAI; // Hermes/Nous API (OpenAI-compatible)
}

/**
 * Generate a completion from the appropriate provider for `options.model`.
 */
export async function generateText(
    clients: LlmClients,
    options: GenerateOptions
): Promise<GenerateResult> {
    if (isXaiModel(options.model)) {
        return generateWithXai(clients.xai, options);
    }
    if (isHermesModel(options.model)) {
        if (!clients.hermes) {
            throw new Error(`Hermes client not initialized for model: ${options.model}`);
        }
        return generateWithHermes(clients.hermes, options);
    }
    return generateWithAnthropic(clients.anthropic, options);
}

async function generateWithAnthropic(
    anthropic: Anthropic,
    options: GenerateOptions
): Promise<GenerateResult> {
    const apiOptions: any = {
        model: options.model,
        messages: options.messages
            .map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content
            }))
            .filter(m => Boolean(m.content)) as MessageParam[],
        max_tokens: options.maxTokens,
        system: options.system || ''
    };

    if (options.extendedThinking) {
        apiOptions.thinking = {
            type: 'enabled',
            budget_tokens: 3000
        };
        apiOptions.max_tokens = options.maxTokens + 3000;
    } else if (
        options.temperature !== undefined &&
        modelSupportsTemperature(options.model)
    ) {
        apiOptions.temperature = options.temperature;
    }

    if (options.webSearchEnabled) {
        apiOptions.tools = [
            {
                type: 'web_search_20250305',
                name: 'web_search',
                max_uses: options.webSearchMaxUses ?? 5
            }
        ];
    }

    const completion = await anthropic.messages.create(apiOptions);
    return parseAnthropicResponse(completion.content as any[]);
}

function parseAnthropicResponse(blocks: any[]): GenerateResult {
    const textParts: string[] = [];
    const sources = new Map<string, string>();
    let searchesPerformed = 0;

    for (const block of blocks) {
        if (block.type === 'text') {
            textParts.push(block.text);
            if (Array.isArray(block.citations)) {
                for (const citation of block.citations) {
                    if (citation.type === 'web_search_result_location' && citation.url) {
                        sources.set(citation.url, citation.title || citation.url);
                    }
                }
            }
        } else if (block.type === 'server_tool_use' && block.name === 'web_search') {
            searchesPerformed++;
        }
    }

    const text = textParts.join('\n\n').trim();
    return {
        content: text || null,
        sources,
        searchesPerformed
    };
}

async function generateWithXai(
    xai: OpenAI,
    options: GenerateOptions
): Promise<GenerateResult> {
    // Stateless multi-turn: we manage history ourselves (matches Anthropic path).
    const input: Array<{ role: string; content: string }> = [];

    if (options.system) {
        input.push({ role: 'system', content: options.system });
    }

    for (const msg of options.messages) {
        if (!msg.content) continue;
        const role = msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user';
        input.push({ role, content: msg.content });
    }

    const apiOptions: any = {
        model: options.model,
        input,
        store: false,
        max_output_tokens: options.extendedThinking
            ? options.maxTokens + 3000
            : options.maxTokens
    };

    if (options.temperature !== undefined) {
        apiOptions.temperature = options.temperature;
    }

    if (options.webSearchEnabled) {
        apiOptions.tools = [{ type: 'web_search' }];
    }

    const response = await xai.responses.create(apiOptions);
    return parseXaiResponse(response);
}

function parseXaiResponse(response: any): GenerateResult {
    const sources = new Map<string, string>();
    let searchesPerformed = 0;
    let text = '';

    // Prefer the convenience field when present
    if (typeof response.output_text === 'string' && response.output_text.trim()) {
        text = response.output_text.trim();
    }

    const output: any[] = Array.isArray(response.output) ? response.output : [];
    for (const item of output) {
        if (item?.type === 'web_search_call' || item?.type === 'server_tool_use') {
            searchesPerformed++;
        }
        if (item?.type === 'message' && Array.isArray(item.content)) {
            for (const part of item.content) {
                if (part.type === 'output_text' && typeof part.text === 'string') {
                    if (!text) text += part.text;
                    if (Array.isArray(part.annotations)) {
                        for (const ann of part.annotations) {
                            if (ann.url) {
                                sources.set(ann.url, ann.title || ann.url);
                            }
                        }
                    }
                }
            }
        }
    }

    // Top-level citations array (URLs only)
    if (Array.isArray(response.citations)) {
        for (const url of response.citations) {
            if (typeof url === 'string' && !sources.has(url)) {
                sources.set(url, url);
            }
        }
    }

    // server_side_tool_usage may report search counts
    const usage = response.server_side_tool_usage || response.serverSideToolUsage;
    if (usage && typeof usage === 'object') {
        const web = usage.web_search ?? usage.WEB_SEARCH ?? usage.SERVER_SIDE_TOOL_WEB_SEARCH;
        if (typeof web === 'number' && web > searchesPerformed) {
            searchesPerformed = web;
        }
    }

    text = text.trim();
    return {
        content: text || null,
        sources,
        searchesPerformed
    };
}

/**
 * Generate with Hermes/Nous API (OpenAI-compatible endpoint).
 */
async function generateWithHermes(
    hermes: OpenAI,
    options: GenerateOptions
): Promise<GenerateResult> {
    // Hermes uses OpenAI-compatible chat completions
    const messages = options.messages
        .map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' as const : 'user' as const,
            content: msg.content
        }))
        .filter(m => Boolean(m.content));

    const apiOptions: any = {
        model: options.model,
        messages: [{ role: 'system', content: options.system || '' }, ...messages],
        max_tokens: options.maxTokens
    };

    if (options.temperature !== undefined) {
        apiOptions.temperature = options.temperature;
    }

    // Hermes supports web search via tool
    if (options.webSearchEnabled) {
        apiOptions.tools = [{ type: 'web_search' }];
    }

    try {
        const response = await hermes.chat.completions.create(apiOptions);
        return parseHermesResponse(response);
    } catch (error: any) {
        // Fallback: try OpenAI-compatible completions API
        const fallbackResponse = await hermes.completions.create({
            model: options.model,
            prompt: options.system ? `${options.system}\n\n${options.messages.map(m => m.content).join('\n')}` : options.messages.map(m => m.content).join('\n'),
            max_tokens: options.maxTokens,
            temperature: options.temperature
        });
        return {
            content: fallbackResponse.choices[0]?.text || null,
            sources: new Map(),
            searchesPerformed: 0
        };
    }
}

function parseHermesResponse(response: any): GenerateResult {
    const sources = new Map<string, string>();
    let searchesPerformed = 0;
    let text = '';

    if (response.choices && response.choices.length > 0) {
        text = response.choices[0]?.message?.content || '';
    }

    // Handle citations if present
    if (response.choices && response.choices[0]?.message?.tool_calls) {
        for (const tc of response.choices[0]?.message?.tool_calls || []) {
            if (tc.type === 'function' || tc.type === 'web_search') {
                searchesPerformed++;
            }
        }
    }

    // Handle tool results with citations
    if (response.choices && response.choices[0]?.message?.content) {
        const content = response.choices[0].message.content;
        if (typeof content === 'string') {
            text = content;
        }
    }

    text = text.trim();
    return {
        content: text || null,
        sources,
        searchesPerformed
    };
}

/** Append a Sources footer when citations are present (shared formatting). */
export function withSourcesFooter(content: string, sources: Map<string, string>): string {
    if (sources.size === 0) return content;
    const sourceLines = Array.from(sources.entries())
        .map(([url, title]) => `- [${title}](${url})`)
        .join('\n');
    return `${content}\n\n**Sources:**\n${sourceLines}`;
}
