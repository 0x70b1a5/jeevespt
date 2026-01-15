import { CommandHandler } from './commands';
import { BotState, ResponseFrequency } from './bot';
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

describe('CommandHandler', () => {
  let handler: CommandHandler;
  let state: BotState;

  beforeEach(() => {
    jest.clearAllMocks();
    state = new BotState();
    handler = new CommandHandler(state, mockOpenAI, mockAnthropic, mockElevenLabs);
  });

  describe('handleCommand', () => {
    it('should handle !help command', async () => {
      const message = createMockMessage({ content: '!help' });
      await handler.handleCommand(message, false);
      
      expect(message.channel.send).toHaveBeenCalled();
    });

    it('should handle !clear command', async () => {
      const message = createMockMessage({ content: '!clear' });
      
      // Add some messages to log first
      const log = state.getLog('guild123', false);
      log.messages.push({ role: 'user', content: 'test' });
      
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Cleared'));
      expect(state.getLog('guild123', false).messages).toHaveLength(0);
    });

    it('should handle !jeeves command', async () => {
      const message = createMockMessage({ content: '!jeeves' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Jeeves'));
      expect(state.getConfig('guild123', false).mode).toBe('jeeves');
    });

    it('should handle !tokipona command', async () => {
      const message = createMockMessage({ content: '!tokipona' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('toki pona'));
      expect(state.getConfig('guild123', false).mode).toBe('tokipona');
    });

    it('should handle !whisper command', async () => {
      const message = createMockMessage({ content: '!whisper' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('transcription'));
      expect(state.getConfig('guild123', false).mode).toBe('whisper');
    });

    it('should handle !temperature command with valid value', async () => {
      const message = createMockMessage({ content: '!temperature 0.5' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('0.5'));
      expect(state.getConfig('guild123', false).temperature).toBe(0.5);
    });

    it('should reject !temperature with invalid value', async () => {
      const message = createMockMessage({ content: '!temperature 3.0' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Couldn\'t parse'));
    });

    it('should handle !delay command', async () => {
      const message = createMockMessage({ content: '!delay 5' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('5 seconds'));
      expect(state.getConfig('guild123', false).responseDelayMs).toBe(5000);
    });

    it('should handle !tokens command', async () => {
      const message = createMockMessage({ content: '!tokens 500' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('500'));
      expect(state.getConfig('guild123', false).maxResponseLength).toBe(500);
    });

    it('should handle !limit command', async () => {
      const message = createMockMessage({ content: '!limit 50' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('50'));
      expect(state.getConfig('guild123', false).messageLimit).toBe(50);
    });

    it('should handle !speedscalar command with valid value', async () => {
      const message = createMockMessage({ content: '!speedscalar 2.0' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('2'));
      expect(state.getConfig('guild123', false).transcriptionSpeedScalar).toBe(2.0);
    });

    it('should reject !speedscalar with out-of-range value', async () => {
      const message = createMockMessage({ content: '!speedscalar 10.0' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Failed'));
    });

    it('should handle !persist command', async () => {
      const message = createMockMessage({ content: '!persist' });
      const initialValue = state.getConfig('guild123', false).shouldSaveData;
      
      await handler.handleCommand(message, false);
      
      expect(state.getConfig('guild123', false).shouldSaveData).toBe(!initialValue);
    });

    it('should handle !dms command', async () => {
      const message = createMockMessage({ content: '!dms' });
      const initialValue = state.getConfig('guild123', false).allowDMs;
      
      await handler.handleCommand(message, false);
      
      expect(state.getConfig('guild123', false).allowDMs).toBe(!initialValue);
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

    // Learning commands
    it('should handle !learnon command', async () => {
      const message = createMockMessage({ content: '!learnon' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('enabled'));
      expect(state.getConfig('guild123', false).learningEnabled).toBe(true);
    });

    it('should handle !learnoff command', async () => {
      const message = createMockMessage({ content: '!learnoff' });
      state.updateConfig('guild123', false, { learningEnabled: true });
      
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('disabled'));
      expect(state.getConfig('guild123', false).learningEnabled).toBe(false);
    });

    it('should handle !learnadd command', async () => {
      const message = createMockMessage({ content: '!learnadd Ancient Greek' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Ancient Greek'));
      expect(state.getConfig('guild123', false).learningSubjects).toContain('Ancient Greek');
    });

    it('should handle !learnremove command', async () => {
      const message = createMockMessage({ content: '!learnremove Latin' });
      await handler.handleCommand(message, false);
      
      expect(state.getConfig('guild123', false).learningSubjects).not.toContain('Latin');
    });

    // Voice commands
    it('should handle !voiceon command', async () => {
      const message = createMockMessage({ content: '!voiceon' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('ENABLED'));
      expect(state.getConfig('guild123', false).useVoiceResponse).toBe(true);
    });

    it('should handle !voiceoff command', async () => {
      const message = createMockMessage({ content: '!voiceoff' });
      state.updateConfig('guild123', false, { useVoiceResponse: true });
      
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('DISABLED'));
      expect(state.getConfig('guild123', false).useVoiceResponse).toBe(false);
    });

    // Muse commands
    it('should handle !museon command', async () => {
      const message = createMockMessage({ content: '!museon' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('now'));
      expect(state.getConfig('guild123', false).shouldMuseRegularly).toBe(true);
    });

    it('should handle !museoff command', async () => {
      const message = createMockMessage({ content: '!museoff' });
      await handler.handleCommand(message, false);
      
      expect(state.getConfig('guild123', false).shouldMuseRegularly).toBe(false);
    });

    it('should handle !museinterval command', async () => {
      const message = createMockMessage({ content: '!museinterval 12' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('12 hours'));
      expect(state.getConfig('guild123', false).museInterval).toBe(12 * 60 * 60 * 1000);
    });

    // Reaction mode commands
    it('should handle !reacton command in guild', async () => {
      const message = createMockMessage({ content: '!reacton' });
      await handler.handleCommand(message, false);
      
      expect(state.getConfig('guild123', false).reactionModeEnabled).toBe(true);
    });

    it('should reject !reacton in DM', async () => {
      const message = createMockMessage({ content: '!reacton', isDM: true, guildId: null });
      await handler.handleCommand(message, true);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('only available in servers'));
    });

    // Channel config commands
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
    it('should handle !translateadd command', async () => {
      const message = createMockMessage({ content: '!translateadd general Spanish' });
      await handler.handleCommand(message, false);
      
      const language = state.getAutotranslateLanguage('guild123', false, 'channel123');
      expect(language).toBe('Spanish');
    });

    it('should handle !translateremove command', async () => {
      state.addAutotranslateChannel('guild123', false, 'channel123', 'Spanish');
      const message = createMockMessage({ content: '!translateremove general' });
      await handler.handleCommand(message, false);
      
      expect(state.getAutotranslateLanguage('guild123', false, 'channel123')).toBeNull();
    });

    it('should handle !translatelist command', async () => {
      state.addAutotranslateChannel('guild123', false, 'channel123', 'Spanish');
      const message = createMockMessage({ content: '!translatelist' });
      await handler.handleCommand(message, false);
      
      expect(message.reply).toHaveBeenCalled();
    });
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
  });

  describe('generateResponse', () => {
    it('should call anthropic API with correct parameters', async () => {
      mockAnthropic.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hello, sir.' }]
      });

      // Add a message to the buffer
      const buffer = state.getBuffer('guild123', false);
      buffer.messages.push({ role: 'user', content: 'Hello Jeeves' });

      const response = await handler.generateResponse('guild123', false);
      
      expect(mockAnthropic.messages.create).toHaveBeenCalled();
      expect(response?.content).toBe('Hello, sir.');
      expect(response?.role).toBe('assistant');
    });

    it('should return null when API returns non-text content', async () => {
      mockAnthropic.messages.create.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'test' }]
      });

      const buffer = state.getBuffer('guild123', false);
      buffer.messages.push({ role: 'user', content: 'Hello' });

      const response = await handler.generateResponse('guild123', false);
      expect(response).toBeNull();
    });

    it('should retry on retryable errors', async () => {
      const retryError = new Error('Rate limited');
      (retryError as any).headers = { 'x-should-retry': 'true' };
      
      mockAnthropic.messages.create
        .mockRejectedValueOnce(retryError)
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Success after retry' }]
        });

      const buffer = state.getBuffer('guild123', false);
      buffer.messages.push({ role: 'user', content: 'Hello' });

      const response = await handler.generateResponse('guild123', false);
      
      expect(mockAnthropic.messages.create).toHaveBeenCalledTimes(2);
      expect(response?.content).toBe('Success after retry');
    });

    it('should throw after max retries', async () => {
      const retryError = new Error('Rate limited');
      (retryError as any).headers = { 'x-should-retry': 'true' };
      
      mockAnthropic.messages.create.mockRejectedValue(retryError);

      const buffer = state.getBuffer('guild123', false);
      buffer.messages.push({ role: 'user', content: 'Hello' });

      await expect(handler.generateResponse('guild123', false)).rejects.toThrow();
      expect(mockAnthropic.messages.create).toHaveBeenCalledTimes(4); // Initial + 3 retries
    }, 20000); // Extended timeout for exponential backoff
  });

  describe('splitMessageIntoChunks (via public interface)', () => {
    // We test this indirectly through the log command
    it('should split long messages into chunks', async () => {
      const longContent = 'a'.repeat(5000);
      const log = state.getLog('guild123', false);
      log.messages.push({ role: 'user', content: longContent });

      const message = createMockMessage({ content: '!log' });
      await handler.handleCommand(message, false);

      // Should have called send multiple times for chunks
      expect((message.channel.send as jest.Mock).mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('handleMessage', () => {
    it('should add message to buffer and log', async () => {
      const message = createMockMessage({ content: 'Hello Jeeves!' });
      
      // Don't wait for the delayed response
      await handler.handleMessage(message, false, false);
      
      const buffer = state.getBuffer('guild123', false);
      const log = state.getLog('guild123', false);
      
      expect(buffer.messages.length).toBeGreaterThan(0);
      expect(log.messages.length).toBeGreaterThan(0);
    });

    it('should handle whisper mode without generating response', async () => {
      state.updateConfig('guild123', false, { mode: 'whisper' });
      const message = createMockMessage({ content: 'Hello' });
      
      await handler.handleMessage(message, false, true);
      
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('audio'));
    });
  });
});
