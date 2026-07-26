import { generateText, withSourcesFooter } from './generate';

describe('generateText', () => {
  const mockAnthropic = {
    messages: { create: jest.fn() }
  } as any;

  const mockXai = {
    responses: { create: jest.fn() }
  } as any;

  const mockHermes = {
    chat: { completions: { create: jest.fn() } }
  } as any;

  const clients = { anthropic: mockAnthropic, xai: mockXai, hermes: mockHermes };

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

    it('routes poolside models to the Hermes client', async () => {
      mockHermes.chat.completions.create.mockResolvedValueOnce({
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

      expect(mockHermes.chat.completions.create).toHaveBeenCalledTimes(1);
      expect(mockAnthropic.messages.create).not.toHaveBeenCalled();
      expect(mockXai.responses.create).not.toHaveBeenCalled();
      expect(result.content).toBe('Laguna says hello');

      const call = mockHermes.chat.completions.create.mock.calls[0][0];
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

    it('throws when a poolside model is selected but no Hermes client is configured', async () => {
      await expect(generateText(
        { anthropic: mockAnthropic, xai: mockXai },
        {
          model: 'poolside/laguna-s-2.1',
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 100
        }
      )).rejects.toThrow('Hermes client not initialized');
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

  describe('Poolside (Hermes) path', () => {
    it('omits the system message when empty', async () => {
      mockHermes.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }]
      });

      await generateText(clients, {
        model: 'poolside/laguna-m.1',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 50
      });

      expect(mockHermes.chat.completions.create.mock.calls[0][0].messages).toEqual([
        { role: 'user', content: 'Hi' }
      ]);
    });

    it('does not send tools even when web search is enabled (Poolside rejects non-function tools)', async () => {
      mockHermes.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'No search, sir.' } }]
      });

      const result = await generateText(clients, {
        model: 'poolside/laguna-xs-2.1',
        messages: [{ role: 'user', content: 'News?' }],
        maxTokens: 200,
        webSearchEnabled: true,
        webSearchMaxUses: 3
      });

      const call = mockHermes.chat.completions.create.mock.calls[0][0];
      expect(call.tools).toBeUndefined();
      expect(result.content).toBe('No search, sir.');
      expect(result.searchesPerformed).toBe(0);
    });
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
