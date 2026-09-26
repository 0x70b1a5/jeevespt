import { CommandHandler } from './commands';
import { BotState, ResponseFrequency } from './state';
import { Message, TextChannel, Guild, Collection, GuildMember, User, DMChannel } from 'discord.js';

// Mock selenium-webdriver before it gets imported
jest.mock('selenium-webdriver', () => ({
  Builder: jest.fn().mockReturnValue({
    forBrowser: jest.fn().mockReturnThis(),
    setChromeOptions: jest.fn().mockReturnThis(),
    build: jest.fn().mockResolvedValue({
      get: jest.fn(),
      sleep: jest.fn(),
      getPageSource: jest.fn().mockResolvedValue('<html><body>Mock page</body></html>'),
      quit: jest.fn()
    })
  })
}));

jest.mock('selenium-webdriver/chrome', () => ({
  Options: jest.fn().mockImplementation(() => ({
    addArguments: jest.fn().mockReturnThis()
  }))
}));

// Mock getWebpage module
jest.mock('./getWebpage', () => ({
  getWebpage: jest.fn().mockResolvedValue('Mock webpage content')
}));

// Mock all external dependencies
jest.mock('fs', () => ({
  promises: {
    readdir: jest.fn().mockResolvedValue([]),
    readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined)
  },
  readFileSync: jest.fn().mockReturnValue('mock prompt content'),
  createReadStream: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  unlinkSync: jest.fn(),
  createWriteStream: jest.fn()
}));

// Mock the prompts module
jest.mock('./prompts/prompts', () => ({
  JEEVES_PROMPT: 'You are Jeeves, a butler.',
  JEEVES_GROK_ADDENDUM: 'Grok wears the Jeeves suit.',
  WEB_SEARCH_ADDENDUM: ' You may use the web_search tool.',
  TOKIPONA_PROMPT: 'sina jan pi toki pona.',
  LEARNING_PROMPT_TEMPLATE: 'Create questions about {SUBJECT}.'
}));

// Create mock clients
const mockOpenAI = {
  audio: {
    transcriptions: {
      create: jest.fn()
    }
  }
} as any;

const mockXai = {
  responses: {
    create: jest.fn()
  }
} as any;

const mockAnthropic = {
  messages: {
    create: jest.fn()
  }
} as any;

const mockElevenLabs = {
  synthesizeSpeech: jest.fn()
} as any;

// Helper to create mock Discord message
function createMockMessage(options: {
  content?: string;
  authorId?: string;
  authorTag?: string;
  guildId?: string | null;
  channelId?: string;
  channelType?: number;
  isDM?: boolean;
}): Message {
  const mockUser = {
    id: options.authorId || 'user123',
    tag: options.authorTag || 'testuser#1234',
    username: 'testuser',
    bot: false
  } as User;

  const mockMember = {
    displayName: 'Test User'
  } as GuildMember;

  const mockChannel = {
    id: options.channelId || 'channel123',
    type: options.channelType ?? (options.isDM ? 1 : 0),
    send: jest.fn().mockResolvedValue(undefined),
    sendTyping: jest.fn().mockResolvedValue(undefined),
    messages: {
      fetch: jest.fn().mockResolvedValue(new Collection())
    },
    fetchWebhooks: jest.fn().mockResolvedValue(new Collection()),
    createWebhook: jest.fn().mockResolvedValue({
      send: jest.fn().mockResolvedValue(undefined)
    })
  };

  const mockGuild = options.guildId !== null ? {
    id: options.guildId || 'guild123',
    channels: {
      cache: new Collection([
        ['channel123', { id: 'channel123', name: 'general' }],
        ['channel456', { id: 'channel456', name: 'random' }]
      ])
    }
  } as unknown as Guild : null;

  return {
    content: options.content || '!help',
    author: mockUser,
    member: mockMember,
    channel: mockChannel,
    guild: mockGuild,
    attachments: new Collection(),
    embeds: [],
    reply: jest.fn().mockResolvedValue(undefined),
    react: jest.fn().mockResolvedValue(undefined),
    cleanContent: options.content || '!help',
    createdTimestamp: Date.now()
  } as unknown as Message;
}

/** A channel whose history is the given texts (oldest first), all from testuser. */
function chatChannel(...texts: string[]) {
  const messages = texts.map((text, i) => ({
    id: `m${i}`,
    content: text,
    cleanContent: text,
    createdTimestamp: 1_700_000_000_000 + i * 1000,
    author: { id: 'user123', username: 'testuser', bot: false },
    member: { displayName: 'Test User' },
    attachments: new Collection(),
    embeds: [],
    url: `https://discord.com/channels/guild123/channel123/m${i}`
  }));
  return {
    id: 'channel123',
    client: { user: { id: 'bot1' } },
    messages: {
      // Discord returns newest first
      fetch: jest.fn().mockResolvedValue(new Collection([...messages].reverse().map(m => [m.id, m] as [string, any])))
    }
  };
}

/** Let timers set to 0 ms and the promise chains behind them run. */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 5));
}

/** All ❌ buttons in a list message payload, in order. */
function listButtons(payload: any): any[] {
  return payload.components.flatMap((row: any) => row.toJSON().components);
}

/** A button click on a list/settings message, as handleComponent sees it. */
function fakeButton(customId: string, userId = 'user123') {
  return {
    customId,
    guildId: 'guild123',
    user: { id: userId, username: 'tester', displayName: 'Tester' },
    inGuild: () => true,
    memberPermissions: { has: () => false },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    update: jest.fn(),
    reply: jest.fn()
  } as any;
}

describe('CommandHandler', () => {
  let handler: CommandHandler;
  let state: BotState;

  beforeEach(() => {
    jest.clearAllMocks();
    state = new BotState();
    handler = new CommandHandler(state, mockOpenAI, mockXai, mockAnthropic, mockElevenLabs);
  });

  describe('handleCommand', () => {
    it('should handle !help command', async () => {
      const message = createMockMessage({ content: '!help' });
      await handler.handleCommand(message, false);

      // Help is now a single generated embed reply, not a 13-message dump.
      expect(message.reply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });

    it('should handle !clear command', async () => {
      const message = createMockMessage({ content: '!clear' });
      const before = Date.now();

      await handler.handleCommand(message, false);

      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('afresh'));
      expect(state.getConfig('guild123', false).contextResetAt).toBeGreaterThanOrEqual(before);
    });

    it('should handle !prompt command', async () => {
      const message = createMockMessage({ content: '!prompt You are a helpful robot.' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Prompt set'));
      expect(state.getConfig('guild123', false).mode).toBe('customprompt');
      expect(state.getCustomPrompt('guild123', false)).toBe('You are a helpful robot.');
    });

    it('should handle unrecognized command', async () => {
      const message = createMockMessage({ content: '!unknowncommand' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Unrecognized'));
    });

    it('points retired commands at their new home without changing anything', async () => {
      const before = state.getConfig('guild123', false).maxResponseLength;
      for (const [cmd, where] of [['!tokens 500', '/settings'], ['!thinkon', '/settings'], ['!jeeves', 'Persona'],
                                  ['!canceltask abc', '/tasks'], ['!translateadd general Spanish', '/translate']]) {
        const message = createMockMessage({ content: cmd });
        await handler.handleCommand(message, false);
        expect(message.reply).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`has moved.*${where}`)));
      }
      expect(state.getConfig('guild123', false).maxResponseLength).toBe(before);
      expect(state.getAutotranslateLanguage('guild123', false, 'channel123')).toBeNull();
    });

    it('retires names cleanly: none still registered, every redirect names a real command', () => {
      const { RETIRED_COMMANDS } = require('./commands/retired');
      const { registry } = require('./commands/registry');
      for (const [name, where] of Object.entries(RETIRED_COMMANDS) as [string, string][]) {
        expect(registry.has(name)).toBe(false);
        const target = where.match(/`\/([a-z]+)/)![1];
        expect(registry.has(target)).toBe(true);
      }
    });

    it('!learning adds a subject and lists it with a remove button', async () => {
      const message = createMockMessage({ content: '!learning Ancient Greek' });
      await handler.handleCommand(message, false);

      expect(state.getConfig('guild123', false).learningSubjects).toContain('Ancient Greek');
      const payload = (message.reply as jest.Mock).mock.calls[0][0];
      expect(payload.embeds[0].toJSON().description).toContain('Added **Ancient Greek**');

      const subjects = state.getConfig('guild123', false).learningSubjects;
      const button = listButtons(payload)[subjects.indexOf('Ancient Greek')];
      const click = fakeButton(button.custom_id);
      await handler.handleComponent(click);
      expect(state.getConfig('guild123', false).learningSubjects).not.toContain('Ancient Greek');
      expect(click.update).toHaveBeenCalled();
    });

    it('!translate adds channels and people, and lists both', async () => {
      await handler.handleCommand(createMockMessage({ content: '!translate general Spanish' }), false);
      await handler.handleCommand(createMockMessage({ content: '!translate <@999> Old Norse' }), false);
      expect(state.getAutotranslateLanguage('guild123', false, 'channel123')).toBe('Spanish');
      expect(state.getAllAutotranslateUsers('guild123', false)).toContainEqual(expect.objectContaining({ userId: '999', language: 'Old Norse' }));

      const list = createMockMessage({ content: '!translate' });
      await handler.handleCommand(list, false);
      const description = (list.reply as jest.Mock).mock.calls[0][0].embeds[0].toJSON().description;
      expect(description).toContain('<#channel123> → **Spanish**');
      expect(description).toContain('<@999> → **Old Norse**');
    });

    it('!reactchannels adds a channel', async () => {
      await handler.handleCommand(createMockMessage({ content: '!reactchannels general' }), false);
      expect(state.getConfig('guild123', false).reactionChannels).toContain('channel123');
    });

    it('!whitelist: anyone may view, only admins may add', async () => {
      const viewer = createMockMessage({ content: '!whitelist' });
      (viewer as any).member = { permissions: { has: () => false } };
      await handler.handleCommand(viewer, false);
      expect((viewer.reply as jest.Mock).mock.calls[0][0].embeds).toBeDefined();

      const nonAdmin = createMockMessage({ content: '!whitelist settings' });
      (nonAdmin as any).member = { permissions: { has: () => false } };
      await handler.handleCommand(nonAdmin, false);
      expect(state.getConfig('guild123', false).commandWhitelist).not.toContain('settings');

      const admin = createMockMessage({ content: '!whitelist settings' });
      (admin as any).member = { permissions: { has: () => true } };
      await handler.handleCommand(admin, false);
      expect(state.getConfig('guild123', false).commandWhitelist).toContain('settings');
    });

    it('!reminders: only the owner can cancel, and a stale list refreshes instead of removing', async () => {
      state.addReminder({
        id: 'r1', userId: 'user123', channelId: 'channel123', content: 'tea',
        triggerTime: new Date(Date.now() + 60_000), isDM: false
      });
      const message = createMockMessage({ content: '!reminders' });
      await handler.handleCommand(message, false);
      const [button] = listButtons((message.reply as jest.Mock).mock.calls[0][0]);

      const stranger = fakeButton(button.custom_id, 'someone-else');
      await handler.handleComponent(stranger);
      expect(stranger.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
      expect(state.getReminder('r1')).toBeDefined();

      const stale = fakeButton(button.custom_id.replace(/:[^:]+$/, ':zzzz'), 'user123');
      await handler.handleComponent(stale);
      expect(state.getReminder('r1')).toBeDefined();
      expect(stale.update.mock.calls[0][0].embeds[0].toJSON().description).toContain('had changed');

      const owner = fakeButton(button.custom_id, 'user123');
      await handler.handleComponent(owner);
      expect(state.getReminder('r1')).toBeUndefined();
    });

    it('should handle !config show (no args)', async () => {
      const message = createMockMessage({ content: '!config' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalled();
    });

    it('should handle !config set channel frequency', async () => {
      const message = createMockMessage({ content: '!config general all' });
      await handler.handleCommand(message, false);
      
      const membership = state.getChannelMembership('guild123', false, 'channel123');
      expect(membership?.responseFrequency).toBe('all');
    });

    it('should reject invalid response frequency', async () => {
      const message = createMockMessage({ content: '!config general invalid' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Invalid response frequency'));
    });

    // Autotranslate commands
  });

  describe('getSystemPrompt', () => {
    it('should return jeeves prompt for jeeves mode', () => {
      state.updateConfig('guild123', false, { mode: 'jeeves' });
      const prompt = handler.getSystemPrompt('guild123', false);
      expect(prompt?.content).toContain('Jeeves');
    });

    it('should return tokipona prompt for tokipona mode', () => {
      state.updateConfig('guild123', false, { mode: 'tokipona' });
      const prompt = handler.getSystemPrompt('guild123', false);
      expect(prompt?.content).toContain('toki pona');
    });

    it('should return null for whisper mode', () => {
      state.updateConfig('guild123', false, { mode: 'whisper' });
      const prompt = handler.getSystemPrompt('guild123', false);
      expect(prompt).toBeNull();
    });

    it('should return custom prompt for customprompt mode', () => {
      state.updateConfig('guild123', false, { mode: 'customprompt' });
      state.setCustomPrompt('guild123', false, 'You are a pirate!');
      const prompt = handler.getSystemPrompt('guild123', false);
      expect(prompt?.content).toBe('You are a pirate!');
    });

    it('appends the Grok addendum only for grok models', () => {
      state.updateConfig('guild123', false, { mode: 'jeeves', model: 'claude-opus-5' });
      expect(handler.getSystemPrompt('guild123', false)?.content).not.toContain('Grok wears the Jeeves suit.');

      state.updateConfig('guild123', false, { model: 'grok-4.5' });
      const grokPrompt = handler.getSystemPrompt('guild123', false)?.content || '';
      expect(grokPrompt).toContain('You are Jeeves, a butler.');
      expect(grokPrompt).toContain('Grok wears the Jeeves suit.');
    });
  });

  describe('generateResponse', () => {
    it('should call anthropic API with correct parameters', async () => {
      mockAnthropic.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hello, sir.' }]
      });

      const response = await handler.generateResponse('guild123', false, [], false, { channel: chatChannel('Hello Jeeves') });
      
      expect(mockAnthropic.messages.create).toHaveBeenCalled();
      expect(mockXai.responses.create).not.toHaveBeenCalled();
      expect(response?.content).toBe('Hello, sir.');
      expect(response?.role).toBe('assistant');
    });

    it('should call xAI Responses API when model is a Grok model', async () => {
      state.updateConfig('guild123', false, { model: 'grok-4.5' });
      mockXai.responses.create.mockResolvedValueOnce({
        output_text: 'Very good, sir. Grok reporting for duty.',
        output: []
      });

      const response = await handler.generateResponse('guild123', false, [], false, { channel: chatChannel('Hello Jeeves') });

      expect(mockXai.responses.create).toHaveBeenCalled();
      expect(mockAnthropic.messages.create).not.toHaveBeenCalled();
      const call = mockXai.responses.create.mock.calls[0][0];
      expect(call.model).toBe('grok-4.5');
      expect(call.store).toBe(false);
      expect(call.input.some((m: any) => m.role === 'system')).toBe(true);
      expect(call.input.some((m: any) => m.role === 'user' && m.content.includes('Hello Jeeves'))).toBe(true);
      expect(response?.content).toBe('Very good, sir. Grok reporting for duty.');
      expect(response?.role).toBe('assistant');
    });

    it('should pass web_search tool to xAI when web search is enabled', async () => {
      state.updateConfig('guild123', false, {
        model: 'grok-4.5',
        webSearchEnabled: true
      });
      mockXai.responses.create.mockResolvedValueOnce({
        output_text: 'According to the papers, sir…',
        output: [{ type: 'web_search_call' }],
        citations: ['https://example.com']
      });

      const response = await handler.generateResponse('guild123', false, [], false, { channel: chatChannel('What is the news?') });

      const call = mockXai.responses.create.mock.calls[0][0];
      expect(call.tools).toContainEqual({ type: 'web_search' });
      expect(call.tools).toContainEqual(expect.objectContaining({ type: 'function', name: 'fetch_webpage' }));
      expect(response?.content).toContain('According to the papers');
      expect(response?.content).toContain('**Sources:**');
      expect(response?.content).toContain('https://example.com');
    });

    it('should return null when API returns non-text content', async () => {
      mockAnthropic.messages.create.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'test' }]
      });

      const response = await handler.generateResponse('guild123', false, [], false, { channel: chatChannel('Hello') });
      expect(response).toBeNull();
    });

    it('lets the agent queue a setting proposal when proposals are allowed', async () => {
      mockAnthropic.messages.create
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'tu1', name: 'propose_setting_change',
            input: { setting: 'webSearchEnabled', value: 'on', reason: 'The news changes daily, sir.' } }]
        })
        .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'I have suggested web search, sir.' }] });

      state.updateConfig('guild123', false, { webSearchEnabled: false });
      const response = await handler.generateResponse('guild123', false, [], false, {
        allowProposals: true, channel: chatChannel('Latest news?')
      });

      const call = mockAnthropic.messages.create.mock.calls[0][0];
      expect(call.tools.map((t: any) => t.name)).toContain('propose_setting_change');
      expect(call.system).toContain('[Your current bot settings]');
      expect(response?.proposals).toEqual([{ key: 'webSearchEnabled', value: true, reason: 'The news changes daily, sir.' }]);
      expect(state.getConfig('guild123', false).webSearchEnabled).toBe(false); // nothing applied yet
    });

    it('does not offer the proposal tool by default', async () => {
      mockAnthropic.messages.create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Hello.' }] });
      await handler.generateResponse('guild123', false, [], false, { channel: chatChannel('Hi') });
      const call = mockAnthropic.messages.create.mock.calls[0][0];
      expect(call.tools.map((t: any) => t.name)).not.toContain('propose_setting_change');
    });

    it('propagates API errors without retrying (the SDK client owns retries)', async () => {
      mockAnthropic.messages.create.mockRejectedValue(new Error('Rate limited'));

      await expect(handler.generateResponse('guild123', false, [], false, { channel: chatChannel('Hello') })).rejects.toThrow('Rate limited');
      expect(mockAnthropic.messages.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('splitMessageIntoChunks (via public interface)', () => {
    // We test this indirectly through the log command
    it('should split long messages into chunks', async () => {
      const longContent = 'a'.repeat(5000);
      const message = createMockMessage({ content: '!log' });
      (message.channel as any).messages = chatChannel(longContent).messages;
      await handler.handleCommand(message, false);

      // Should have called send multiple times for chunks
      expect(((message.channel as TextChannel).send as jest.Mock).mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('handleMessage', () => {
    it('replies from the channel history after the response delay', async () => {
      state.updateConfig('guild123', false, { responseDelayMs: 0 });
      mockAnthropic.messages.create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Good evening, sir.' }] });
      const message = createMockMessage({ content: 'Hello Jeeves!' });
      (message.channel as any).messages = chatChannel('Hello Jeeves!').messages;

      await handler.handleMessage(message, false, 'reply');
      await flush();

      const call = mockAnthropic.messages.create.mock.calls[0][0];
      expect(JSON.stringify(call.messages)).toContain('Hello Jeeves!');
    });

    it('records but does not reply when the trigger is none', async () => {
      state.updateConfig('guild123', false, { responseDelayMs: 0 });
      await handler.handleMessage(createMockMessage({ content: 'just chatting' }), false, 'none');
      await flush();
      expect(mockAnthropic.messages.create).not.toHaveBeenCalled();
    });

    describe('ambient channels', () => {
      let fetchSpy: jest.SpyInstance;
      const jev = (over: Record<string, any> = {}) => ({
        ok: true, status: 200, headers: new Headers(), text: async () => '',
        json: async () => ({
          answers: {
            addressed: { type: 'noul', noul: 0.05 },
            value: { type: 'score', score: 0.3, probabilities: {}, confidence: 0.9 },
            intrusive: { type: 'noul', noul: 0.05 },
            responds: { type: 'noul', noul: 0.1 },
            reactable: { type: 'noul', noul: 0.1 },
            emoji: { type: 'choice', choice: '😂', probabilities: { '😂': 0.9, '👍': 0.1 }, confidence: 0.8 },
            ...over
          }
        })
      } as any);

      beforeEach(() => {
        process.env.TYPESAFE_API_KEY = 'test-key';
        fetchSpy = jest.spyOn(global, 'fetch');
        state.updateConfig('guild123', false, { responseDelayMs: 0, sociability: 1 });
      });
      afterEach(() => fetchSpy.mockRestore());

      function ambientMessage(text: string) {
        const message = createMockMessage({ content: text });
        (message.channel as any).messages = chatChannel(text).messages;
        (message.channel as any).createWebhook = jest.fn().mockResolvedValue({ id: 'wh1', send: jest.fn().mockResolvedValue({ id: 'sent1' }) });
        return message;
      }

      it('chimes in, briefly, when Jev judges it worthwhile', async () => {
        fetchSpy.mockResolvedValueOnce(jev({ value: { type: 'score', score: 3, probabilities: {}, confidence: 1 } }));
        mockAnthropic.messages.create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Socrates, sir.' }] });
        const message = ambientMessage('who said the unexamined life is not worth living?');

        await handler.handleMessage(message, false, 'ambient');
        await flush();

        const call = mockAnthropic.messages.create.mock.calls[0][0];
        expect(call.system).toContain('[Joining in]');
        expect(call.max_tokens).toBeLessThanOrEqual(400);
        const webhook = await ((message.channel as any).createWebhook as jest.Mock).mock.results[0].value;
        expect(webhook.send).toHaveBeenCalledWith(expect.objectContaining({ content: 'Socrates, sir.' }));
      });

      it('stays quiet when there is nothing to add', async () => {
        fetchSpy.mockResolvedValueOnce(jev());
        const message = ambientMessage('lol same');
        await handler.handleMessage(message, false, 'ambient');
        await flush();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(mockAnthropic.messages.create).not.toHaveBeenCalled();
        expect(message.react).not.toHaveBeenCalled();
      });

      it('reacts instead when the message merits an emoji', async () => {
        fetchSpy.mockResolvedValueOnce(jev({ reactable: { type: 'noul', noul: 0.9 } }));
        const message = ambientMessage('I passed my driving test!');
        (message as any).id = 'm0'; // the latest line in the channel
        await handler.handleMessage(message, false, 'ambient');
        await flush();
        expect(message.react).toHaveBeenCalledWith('😂');
        expect(mockAnthropic.messages.create).not.toHaveBeenCalled();
      });

      it('answers an @mention directly without consulting Jev', async () => {
        mockAnthropic.messages.create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'At once, sir.' }] });
        const message = ambientMessage('@Jeeves a word?');
        (message as any).client = { user: { id: 'bot1' } };
        (message as any).mentions = { users: new Collection([['bot1', {}]]), repliedUser: null };
        await handler.handleMessage(message, false, 'ambient');
        await flush();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(mockAnthropic.messages.create.mock.calls[0][0].system).not.toContain('[Joining in]');
      });

      it('in shadow mode decides and drafts, but posts nothing', async () => {
        state.updateConfig('guild123', false, { ambientShadow: true });
        fetchSpy.mockResolvedValueOnce(jev({ value: { type: 'score', score: 3, probabilities: {}, confidence: 1 } }));
        mockAnthropic.messages.create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Socrates, sir.' }] });
        const message = ambientMessage('who said it?');
        await handler.handleMessage(message, false, 'ambient');
        await flush();
        expect(mockAnthropic.messages.create).toHaveBeenCalled();
        expect((message.channel as any).createWebhook).not.toHaveBeenCalled();
        expect((message.channel as TextChannel).send).not.toHaveBeenCalled();
      });
    });

    it('should handle whisper mode without generating response', async () => {
      state.updateConfig('guild123', false, { mode: 'whisper' });
      const message = createMockMessage({ content: 'Hello' });
      
      await handler.handleMessage(message, false, 'reply');
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('audio'));
    });
  });
});
