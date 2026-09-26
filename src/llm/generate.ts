/**
 * Multi-provider LLM generation (Anthropic Claude + xAI Grok + Poolside).
 *
 * Routes by model id: `grok-*` → xAI Responses API; `poolside/*` → Poolside chat completions;
 * everything else → Anthropic.
 *
 * Agent loop: when `tools` are supplied, each provider keeps calling the model —
 * running whatever tools it asks for and feeding the results back — until it
 * stops on its own (or hits `maxSteps`, at which point it's told to wrap up).
 * Each provider speaks its native tool protocol; only the loop shape is shared.
 */

import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import type {
    ContentBlock,
    MessageCreateParamsNonStreaming,
    MessageParam,
    Tool,
    ToolResultBlockParam,
    ToolUnion,
    ToolUseBlock
} from '@anthropic-ai/sdk/resources/messages';
import { isXaiModel, isPoolsideModel } from '../state/types';
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
    /** Client-side tools the model may call; enables the agent loop. */
    tools?: LlmTool[];
    /** Cap on model round-trips per generation (default DEFAULT_MAX_STEPS). */
    maxSteps?: number;
}

export interface GenerateResult {
    content: string | null;
    sources: Map<string, string>;
    searchesPerformed: number;
    /** Client-side tool invocations across the whole loop. */
    toolCalls: number;
}

/** A client-side tool, described once and translated per provider. */
export interface LlmTool {
    name: string;
    description: string;
    /** JSON Schema for the tool's input object. */
    parameters: Record<string, unknown>;
    /** Returns text for the model. Throwing is fine — the error is reported to the model. */
    run(input: any): Promise<string>;
}

/**
 * Safety valve, not a budget: the model decides when it's done, this only stops
 * a runaway loop. On the last step tools are disabled so it must answer.
 */
export const DEFAULT_MAX_STEPS = 20;

export interface LlmClients {
    anthropic: Anthropic;
    xai: OpenAI;
    poolside?: OpenAI; // Poolside API (OpenAI-compatible)
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
    if (isPoolsideModel(options.model)) {
        if (!clients.poolside) {
            throw new Error(`Poolside client not initialized for model: ${options.model}`);
        }
        return generateWithPoolside(clients.poolside, options);
    }
    return generateWithAnthropic(clients.anthropic, options);
}

/** Run one tool call; failures become error text for the model rather than exceptions. */
async function runTool(
    tools: LlmTool[],
    name: string,
    input: unknown
): Promise<{ output: string; isError: boolean }> {
    const tool = tools.find(t => t.name === name);
    if (!tool) return { output: `Unknown tool: ${name}`, isError: true };
    console.log(`🔧 Tool call: ${name} ${JSON.stringify(input).slice(0, 200)}`);
    try {
        return { output: await tool.run(input ?? {}), isError: false };
    } catch (error: any) {
        console.error(`❌ Tool ${name} failed:`, error);
        return { output: `Tool error: ${error?.message ?? String(error)}`, isError: true };
    }
}

function parseToolArguments(raw: string | undefined): unknown {
    try {
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

/**
 * Folds per-response results into one. A new turn's text supersedes the last —
 * text beside a tool call is narration ("let me check…"), and the final turn
 * carries the answer — except continuations of a paused turn, which pick up
 * mid-stream and are appended. Sources and counts accumulate across all turns.
 */
class ResultAccumulator {
    private text = '';
    readonly sources = new Map<string, string>();
    searchesPerformed = 0;
    toolCalls = 0;

    add(turn: GenerateResult, continuesPreviousTurn = false): void {
        const part = turn.content ?? '';
        if (continuesPreviousTurn) {
            this.text += part;
        } else if (part.trim()) {
            this.text = part;
        }
        for (const [url, title] of turn.sources) this.sources.set(url, title);
        this.searchesPerformed += turn.searchesPerformed;
    }

    result(): GenerateResult {
        const text = this.text.trim();
        return {
            content: text || null,
            sources: this.sources,
            searchesPerformed: this.searchesPerformed,
            toolCalls: this.toolCalls
        };
    }
}

async function generateWithAnthropic(
    anthropic: Anthropic,
    options: GenerateOptions
): Promise<GenerateResult> {
    const messages: MessageParam[] = options.messages
        .map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' as const : 'user' as const,
            content: msg.content
        }))
        .filter(m => Boolean(m.content));

    const apiOptions: MessageCreateParamsNonStreaming = {
        model: options.model,
        messages,
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

    const tools: ToolUnion[] = [];
    if (options.webSearchEnabled) {
        tools.push({
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: options.webSearchMaxUses ?? 5
        });
    }
    const clientTools = options.tools ?? [];
    for (const tool of clientTools) {
        tools.push({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters as Tool['input_schema']
        });
    }
    if (tools.length) apiOptions.tools = tools;

    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    const acc = new ResultAccumulator();
    let paused = false;

    for (let step = 1; step <= maxSteps; step++) {
        const request: MessageCreateParamsNonStreaming = { ...apiOptions, messages: [...messages] };
        if (step === maxSteps && clientTools.length) {
            request.tool_choice = { type: 'none' };
        }

        const completion = await anthropic.messages.create(request);
        acc.add(parseAnthropicResponse(completion.content), paused);
        paused = false;

        if (completion.stop_reason === 'pause_turn') {
            // Server-side tool loop (web search) hit its iteration limit;
            // sending the partial turn back lets the model resume where it left off.
            messages.push({ role: 'assistant', content: completion.content });
            paused = true;
            continue;
        }
        if (completion.stop_reason !== 'tool_use') break;

        const toolUses = completion.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
        if (!toolUses.length) break;

        messages.push({ role: 'assistant', content: completion.content });
        const results: ToolResultBlockParam[] = [];
        // Sequential on purpose: tools like fetch_webpage drive a shared headless browser.
        for (const use of toolUses) {
            const { output, isError } = await runTool(clientTools, use.name, use.input);
            acc.toolCalls++;
            results.push({ type: 'tool_result', tool_use_id: use.id, content: output, is_error: isError });
        }
        messages.push({ role: 'user', content: results });
    }

    return acc.result();
}

function parseAnthropicResponse(blocks: ContentBlock[]): GenerateResult {
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

    // Concatenate directly: web-search responses arrive fragmented into many
    // blocks split mid-sentence at citation boundaries, each carrying its own
    // spacing — any separator here injects breaks into the middle of prose.
    // Untrimmed: a paused turn resumes mid-sentence, so edge whitespace matters
    // (ResultAccumulator trims the final text).
    const text = textParts.join('');
    return {
        content: text.trim() ? text : null,
        sources,
        searchesPerformed,
        toolCalls: 0
    };
}

async function generateWithXai(
    xai: OpenAI,
    options: GenerateOptions
): Promise<GenerateResult> {
    // Stateless multi-turn: we manage history ourselves (matches Anthropic path).
    const input: any[] = [];

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

    const tools: any[] = [];
    if (options.webSearchEnabled) {
        tools.push({ type: 'web_search' });
    }
    const clientTools = options.tools ?? [];
    for (const tool of clientTools) {
        tools.push({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters });
    }
    if (tools.length) apiOptions.tools = tools;

    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    const acc = new ResultAccumulator();

    for (let step = 1; step <= maxSteps; step++) {
        const request = { ...apiOptions, input: [...input] };
        if (step === maxSteps && clientTools.length) {
            request.tool_choice = 'none';
        }

        const response: any = await xai.responses.create(request);
        acc.add(parseXaiResponse(response));

        const output: any[] = Array.isArray(response.output) ? response.output : [];
        const calls = output.filter(item => item?.type === 'function_call');
        if (!calls.length) break;

        // Echo the model's own turn back (store:false means the server keeps nothing).
        input.push(...output.filter(item => item?.type === 'function_call' || item?.type === 'message'));
        for (const call of calls) {
            const { output: result } = await runTool(clientTools, call.name, parseToolArguments(call.arguments));
            acc.toolCalls++;
            input.push({ type: 'function_call_output', call_id: call.call_id, output: result });
        }
    }

    return acc.result();
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
        searchesPerformed,
        toolCalls: 0
    };
}

/**
 * Generate with the Poolside API — OpenAI-compatible chat completions.
 *
 * Web search is a no-op here: Poolside has no server-side web search tool, and
 * its chat API rejects any tool type other than `function`. Client tools
 * (which are `function` tools) work normally.
 */
async function generateWithPoolside(
    poolside: OpenAI,
    options: GenerateOptions
): Promise<GenerateResult> {
    const messages: any[] =
        options.messages
            .map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' as const : 'user' as const,
                content: msg.content
            }))
            .filter(m => Boolean(m.content));

    if (options.system) {
        messages.unshift({ role: 'system', content: options.system });
    }

    const apiOptions: any = {
        model: options.model,
        messages,
        max_tokens: options.maxTokens
    };

    if (options.temperature !== undefined) {
        apiOptions.temperature = options.temperature;
    }

    const clientTools = options.tools ?? [];
    if (clientTools.length) {
        apiOptions.tools = clientTools.map(tool => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters }
        }));
    }

    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    const acc = new ResultAccumulator();

    for (let step = 1; step <= maxSteps; step++) {
        const request = { ...apiOptions, messages: [...messages] };
        if (step === maxSteps && clientTools.length) {
            request.tool_choice = 'none';
        }

        const response: any = await poolside.chat.completions.create(request);
        acc.add(parsePoolsideResponse(response));

        const message = response.choices?.[0]?.message;
        const calls: any[] = message?.tool_calls ?? [];
        if (!calls.length) break;

        messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
        for (const call of calls) {
            const { output } = await runTool(clientTools, call.function?.name, parseToolArguments(call.function?.arguments));
            acc.toolCalls++;
            messages.push({ role: 'tool', tool_call_id: call.id, content: output });
        }
    }

    return acc.result();
}

function parsePoolsideResponse(response: any): GenerateResult {
    const text = (response.choices?.[0]?.message?.content || '').trim();
    return {
        content: text || null,
        sources: new Map(),
        searchesPerformed: 0,
        toolCalls: 0
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
