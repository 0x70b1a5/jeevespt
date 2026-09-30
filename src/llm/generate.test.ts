import { generateText, withSourcesFooter, LlmTool } from './generate';

describe('generateText', () => {
  const mockAnthropic = {
    messages: { create: jest.fn() }
  } as any;

  const mockXai = {
    responses: { create: jest.fn() }
  } as any;

  const mockPoolside = {
    chat: { completions: { create: jest.fn() } }
  } as any;

  const clients = { anthropic: mockAnthropic, xai: mockXai, poolside: mockPoolside };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('routing', () => {
    it('routes claude models to Anthropic', async () => {
      mockAnthropic.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Claude says hello' }]
      });

      const result = await generateText(clients, {
        model: 'claude-sonnet-4-5-20250929',
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
        temperature: 0.5
      });

      expect(mockAnthropic.messages.create).toHaveBeenCalledTimes(1);
      expect(mockXai.responses.create).not.toHaveBeenCalled();
      expect(result.content).toBe('Claude says hello');
    });

    it('routes grok models to xAI', async () => {
      mockXai.responses.create.mockResolvedValueOnce({
        output_text: 'Grok says hello',
        output: []
      });

      const result = await generateText(clients, {
        model: 'grok-4.5',
        system: 'You are Jeeves.',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
        temperature: 0.9
      });

      expect(mockXai.responses.create).toHaveBeenCalledTimes(1);
      expect(mockAnthropic.messages.create).not.toHaveBeenCalled();
      expect(result.content).toBe('Grok says hello');

      const call = mockXai.responses.create.mock.calls[0][0];
      expect(call.model).toBe('grok-4.5');
      expect(call.max_output_tokens).toBe(100);
      expect(call.temperature).toBe(0.9);
      expect(call.store).toBe(false);
      expect(call.input).toEqual([
        { role: 'system', content: 'You are Jeeves.' },
        { role: 'user', content: 'Hi' }
      ]);
    });

    it('routes poolside models to the Poolside client', async () => {
      mockPoolside.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'Laguna says hello' } }]
      });

      const result = await generateText(clients, {
        model: 'poolside/laguna-xs-2.1',
        system: 'You are Jeeves.',
        messages: [
          { role: 'user', content: 'First' },
          { role: 'assistant', content: 'Reply' },
          { role: 'user', content: 'Second' }
        ],
        maxTokens: 100,
        temperature: 0.9
      });

      expect(mockPoolside.chat.completions.create).toHaveBeenCalledTimes(1);
      expect(mockAnthropic.messages.create).not.toHaveBeenCalled();
      expect(mockXai.responses.create).not.toHaveBeenCalled();
      expect(result.content).toBe('Laguna says hello');

      const call = mockPoolside.chat.completions.create.mock.calls[0][0];
      expect(call.model).toBe('poolside/laguna-xs-2.1');
      expect(call.max_tokens).toBe(100);
      expect(call.temperature).toBe(0.9);
      expect(call.messages).toEqual([
        { role: 'system', content: 'You are Jeeves.' },
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Reply' },
        { role: 'user', content: 'Second' }
      ]);
    });

    it('throws when a poolside model is selected but no Poolside client is configured', async () => {
      await expect(generateText(
        { anthropic: mockAnthropic, xai: mockXai },
        {
          model: 'poolside/laguna-s-2.1',
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 100
        }
      )).rejects.toThrow('Poolside client not initialized');
    });
  });

  describe('Anthropic path', () => {
    it('includes extended thinking when requested', async () => {
      mockAnthropic.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Thoughtful answer' }]
      });

      await generateText(clients, {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'Think hard' }],
        maxTokens: 500,
        extendedThinking: true
      });

      const call = mockAnthropic.messages.create.mock.calls[0][0];
      expect(call.thinking).toEqual({ type: 'enabled', budget_tokens: 3000 });
      expect(call.max_tokens).toBe(3500);
    });

    it.each(['claude-opus-5-5', 'claude-opus-4-7', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-sonnet-4-6'])(
      'uses adaptive thinking + effort on %s',
      async (model) => {
        mockAnthropic.messages.create.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Thoughtful answer' }]
        });

        await generateText(clients, {
          model,
          messages: [{ role: 'user', content: 'Think hard' }],
          maxTokens: 500,
          extendedThinking: true
        });

        const call = mockAnthropic.messages.create.mock.calls[0][0];
        expect(call.thinking).toEqual({ type: 'adaptive' });
        expect(call.output_config).toEqual({ effort: 'high' });
        expect(call.max_tokens).toBe(3500);
      }
    );

    it.each([
      ['claude-opus-5-5', 3500],
      ['claude-sonnet-5', 3500],
      ['claude-fable-5-1', 3500],
      ['claude-opus-4-8', 500],
      ['claude-sonnet-4-6', 500],
      ['claude-haiku-4-5', 500]
    ] as const)('leaves room for built-in thinking on %s with extended thinking off', async (model, expected) => {
      mockAnthropic.messages.create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });

      await generateText(clients, {
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 500
      });

      const call = mockAnthropic.messages.create.mock.calls[0][0];
      expect(call.thinking).toBeUndefined();
      expect(call.max_tokens).toBe(expected);
    });

    it('warns when the reply hits max_tokens', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockAnthropic.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'never stood much chance' }],
        stop_reason: 'max_tokens'
      });

      const result = await generateText(clients, {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 400
      });

      expect(result.content).toBe('never stood much chance');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('400-token output cap'));
      warn.mockRestore();
    });

    it.each([
      ['claude-opus-5-5', 'max', false, 'max'],
      ['claude-opus-5-5', 'auto', false, undefined],
      ['claude-sonnet-4-6', 'xhigh', true, 'high'],
      ['claude-sonnet-4-5', 'max', true, undefined],
      ['claude-haiku-4-5', 'low', false, undefined]
    ] as const)('sends effort for %s at %s (thinking %s) → %s', async (model, effort, extendedThinking, expected) => {
      mockAnthropic.messages.create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });

      await generateText(clients, {
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 500,
        extendedThinking,
        effort
      });

      const call = mockAnthropic.messages.create.mock.calls[0][0];
      expect(call.output_config?.effort).toBe(expected);
    });

    it('attaches Anthropic web_search tool when enabled', async () => {
      mockAnthropic.messages.create.mockResolvedValueOnce({
        content: [
          { type: 'server_tool_use', name: 'web_search' },
          {
            type: 'text',
            text: 'Found it',
            citations: [{
              type: 'web_search_result_location',
              url: 'https://example.com',
              title: 'Example'
            }]
          }
        ]
      });

      const result = await generateText(clients, {
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'Search' }],
        maxTokens: 200,
        webSearchEnabled: true,
        webSearchMaxUses: 3
      });

      const call = mockAnthropic.messages.create.mock.calls[0][0];
      expect(call.tools).toEqual([{
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3
      }]);
      expect(result.content).toBe('Found it');
      expect(result.searchesPerformed).toBe(1);
      expect(result.sources.get('https://example.com')).toBe('Example');
    });

    it('reassembles citation-fragmented text blocks without inserting breaks', async () => {
      // Web search fragments the reply into blocks split mid-sentence at
      // citation boundaries; each block carries its own spacing.
      mockAnthropic.messages.create.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'The market grew ' },
          {
            type: 'text',
            text: 'about 12% last year',
            citations: [{
              type: 'web_search_result_location',
              url: 'https://example.com/report',
              title: 'Report'
            }]
          },
          { type: 'text', text: ', sir.' }
        ]
      });

      const result = await generateText(clients, {
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: 'Market?' }],
        maxTokens: 200,
        webSearchEnabled: true
      });

      expect(result.content).toBe('The market grew about 12% last year, sir.');
    });
  });

  describe('xAI path', () => {
    it('parses output blocks when output_text is missing', async () => {
      mockXai.responses.create.mockResolvedValueOnce({
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'From output blocks',
            annotations: [{ url: 'https://x.ai', title: 'xAI' }]
          }]
        }]
      });

      const result = await generateText(clients, {
        model: 'grok-4.3',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 50
      });

      expect(result.content).toBe('From output blocks');
      expect(result.sources.get('https://x.ai')).toBe('xAI');
    });

    it('adds web_search tool and counts searches', async () => {
      mockXai.responses.create.mockResolvedValueOnce({
        output_text: 'News summary',
        output: [{ type: 'web_search_call' }, { type: 'web_search_call' }],
        citations: ['https://a.com', 'https://b.com']
      });

      const result = await generateText(clients, {
        model: 'grok-4.5',
        messages: [{ role: 'user', content: 'News?' }],
        maxTokens: 200,
        webSearchEnabled: true
      });

      expect(mockXai.responses.create.mock.calls[0][0].tools).toEqual([
        { type: 'web_search' }
      ]);
      expect(result.searchesPerformed).toBe(2);
      expect(result.sources.size).toBe(2);
    });

    it('bumps max_output_tokens when extendedThinking is set', async () => {
      mockXai.responses.create.mockResolvedValueOnce({
        output_text: 'ok',
        output: []
      });

      await generateText(clients, {
        model: 'grok-4.5',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 1000,
        extendedThinking: true
      });

      expect(mockXai.responses.create.mock.calls[0][0].max_output_tokens).toBe(4000);
    });

    it('maps multi-turn roles correctly', async () => {
      mockXai.responses.create.mockResolvedValueOnce({
        output_text: 'Yes, sir.',
        output: []
      });

      await generateText(clients, {
        model: 'grok-4.5',
        system: 'You are Jeeves.',
        messages: [
          { role: 'user', content: 'First' },
          { role: 'assistant', content: 'Reply' },
          { role: 'user', content: 'Second' }
        ],
        maxTokens: 100
      });

      expect(mockXai.responses.create.mock.calls[0][0].input).toEqual([
        { role: 'system', content: 'You are Jeeves.' },
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Reply' },
        { role: 'user', content: 'Second' }
      ]);
    });
  });

  describe('Poolside path', () => {
    it('omits the system message when empty', async () => {
      mockPoolside.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }]
      });

      await generateText(clients, {
        model: 'poolside/laguna-m.1',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 50
      });

      expect(mockPoolside.chat.completions.create.mock.calls[0][0].messages).toEqual([
        { role: 'user', content: 'Hi' }
      ]);
    });

    it('does not send tools even when web search is enabled (Poolside rejects non-function tools)', async () => {
      mockPoolside.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'No search, sir.' } }]
      });

      const result = await generateText(clients, {
        model: 'poolside/laguna-xs-2.1',
        messages: [{ role: 'user', content: 'News?' }],
        maxTokens: 200,
        webSearchEnabled: true,
        webSearchMaxUses: 3
      });

      const call = mockPoolside.chat.completions.create.mock.calls[0][0];
      expect(call.tools).toBeUndefined();
      expect(result.content).toBe('No search, sir.');
      expect(result.searchesPerformed).toBe(0);
    });
  });
});

describe('agent loop', () => {
  const mockAnthropic = { messages: { create: jest.fn() } } as any;
  const mockXai = { responses: { create: jest.fn() } } as any;
  const mockPoolside = { chat: { completions: { create: jest.fn() } } } as any;
  const clients = { anthropic: mockAnthropic, xai: mockXai, poolside: mockPoolside };

  const lockerTool: LlmTool = {
    name: 'lookup_locker',
    description: 'Look in a locker',
    parameters: { type: 'object', properties: { n: { type: 'integer' } } },
    run: jest.fn(async ({ n }) => `locker ${n}: brass owl`)
  };
  const base = { messages: [{ role: 'user', content: 'Locker 7?' }], maxTokens: 100, tools: [lockerTool] };

  beforeEach(() => jest.clearAllMocks());

  it('Anthropic: runs tools until the model stops, keeping only the final answer', async () => {
    const toolTurn = [
      { type: 'text', text: 'Let me look.' },
      { type: 'tool_use', id: 'tu_1', name: 'lookup_locker', input: { n: 7 } }
    ];
    mockAnthropic.messages.create
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: toolTurn })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'A brass owl, sir.' }] });

    const result = await generateText(clients, { model: 'claude-sonnet-4-5', ...base });

    expect(lockerTool.run).toHaveBeenCalledWith({ n: 7 });
    expect(result.content).toBe('A brass owl, sir.');
    expect(result.toolCalls).toBe(1);

    const first = mockAnthropic.messages.create.mock.calls[0][0];
    expect(first.tools).toEqual([{ name: 'lookup_locker', description: 'Look in a locker', input_schema: lockerTool.parameters }]);
    const second = mockAnthropic.messages.create.mock.calls[1][0];
    expect(second.messages.slice(1)).toEqual([
      { role: 'assistant', content: toolTurn },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'locker 7: brass owl', is_error: false }] }
    ]);
  });

  it('Anthropic: resumes a paused turn without adding a user message', async () => {
    const paused = [{ type: 'text', text: 'The first half' }];
    mockAnthropic.messages.create
      .mockResolvedValueOnce({ stop_reason: 'pause_turn', content: paused })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: ' and the second.' }] });

    const result = await generateText(clients, { model: 'claude-sonnet-4-5', ...base, tools: undefined, webSearchEnabled: true });

    expect(result.content).toBe('The first half and the second.');
    const second = mockAnthropic.messages.create.mock.calls[1][0];
    expect(second.messages[second.messages.length - 1]).toEqual({ role: 'assistant', content: paused });
  });

  it('Anthropic: reports tool failures to the model instead of throwing', async () => {
    const failing: LlmTool = { ...lockerTool, run: async () => { throw new Error('boom'); } };
    mockAnthropic.messages.create
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'lookup_locker', input: {} }] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'It jammed.' }] });

    const result = await generateText(clients, { model: 'claude-sonnet-4-5', ...base, tools: [failing] });

    const toolResult = mockAnthropic.messages.create.mock.calls[1][0].messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ is_error: true, content: 'Tool error: boom' });
    expect(result.content).toBe('It jammed.');
  });

  it('disables tools on the final allowed step', async () => {
    const toolTurn = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'lookup_locker', input: { n: 1 } }] };
    mockAnthropic.messages.create
      .mockResolvedValueOnce(toolTurn)
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] });

    await generateText(clients, { model: 'claude-sonnet-4-5', ...base, maxSteps: 2 });

    expect(mockAnthropic.messages.create.mock.calls[0][0].tool_choice).toBeUndefined();
    expect(mockAnthropic.messages.create.mock.calls[1][0].tool_choice).toEqual({ type: 'none' });
  });

  it('xAI: feeds function_call_output back and continues', async () => {
    const call = { type: 'function_call', call_id: 'c1', name: 'lookup_locker', arguments: '{"n":7}' };
    mockXai.responses.create
      .mockResolvedValueOnce({ output: [{ type: 'reasoning', id: 'r1' }, call] })
      .mockResolvedValueOnce({ output_text: 'A brass owl.', output: [] });

    const result = await generateText(clients, { model: 'grok-4.5', ...base });

    expect(lockerTool.run).toHaveBeenCalledWith({ n: 7 });
    expect(result.content).toBe('A brass owl.');
    expect(mockXai.responses.create.mock.calls[0][0].tools).toEqual([
      { type: 'function', name: 'lookup_locker', description: 'Look in a locker', parameters: lockerTool.parameters }
    ]);
    expect(mockXai.responses.create.mock.calls[1][0].input.slice(1)).toEqual([
      call,
      { type: 'function_call_output', call_id: 'c1', output: 'locker 7: brass owl' }
    ]);
  });

  it('Poolside: feeds tool messages back and continues', async () => {
    const toolCall = { id: 'c1', type: 'function', function: { name: 'lookup_locker', arguments: '{"n":7}' } };
    mockPoolside.chat.completions.create
      .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [toolCall] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'A brass owl.' } }] });

    const result = await generateText(clients, { model: 'poolside/laguna-xs-2.1', ...base });

    expect(result.content).toBe('A brass owl.');
    expect(mockPoolside.chat.completions.create.mock.calls[1][0].messages.slice(1)).toEqual([
      { role: 'assistant', content: null, tool_calls: [toolCall] },
      { role: 'tool', tool_call_id: 'c1', content: 'locker 7: brass owl' }
    ]);
  });
});

describe('withSourcesFooter', () => {
  it('returns content unchanged when there are no sources', () => {
    expect(withSourcesFooter('Hello', new Map())).toBe('Hello');
  });

  it('appends a Sources section', () => {
    const sources = new Map([['https://a.com', 'A'], ['https://b.com', 'B']]);
    const out = withSourcesFooter('Body', sources);
    expect(out).toContain('Body');
    expect(out).toContain('**Sources:**');
    expect(out).toContain('- [A](https://a.com)');
    expect(out).toContain('- [B](https://b.com)');
  });
});
