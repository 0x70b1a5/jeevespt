import { BotState, BotConfig, isValidAnthropicModel, VALID_ANTHROPIC_MODELS, ResponseFrequency } from './bot';

// Mock fs to avoid actual file operations
jest.mock('fs', () => ({
  promises: {
    readdir: jest.fn().mockResolvedValue([]),
    readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined)
  },
  readFileSync: jest.fn().mockReturnValue('mock prompt content')
}));

describe('isValidAnthropicModel', () => {
  it('should return true for valid current models', () => {
    expect(isValidAnthropicModel('claude-sonnet-4-5-20250929')).toBe(true);
    expect(isValidAnthropicModel('claude-sonnet-4-5')).toBe(true);
    expect(isValidAnthropicModel('claude-haiku-4-5-20251001')).toBe(true);
    expect(isValidAnthropicModel('claude-opus-4-1-20250805')).toBe(true);
  });

  it('should return true for valid legacy models', () => {
    expect(isValidAnthropicModel('claude-3-5-sonnet-latest')).toBe(true);
    expect(isValidAnthropicModel('claude-3-5-sonnet-20241022')).toBe(true);
    expect(isValidAnthropicModel('claude-3-opus-20240229')).toBe(true);
  });

  it('should return false for invalid models', () => {
    expect(isValidAnthropicModel('gpt-4')).toBe(false);
    expect(isValidAnthropicModel('claude-99')).toBe(false);
    expect(isValidAnthropicModel('')).toBe(false);
    expect(isValidAnthropicModel('not-a-model')).toBe(false);
  });

  it('should validate all models in VALID_ANTHROPIC_MODELS', () => {
    VALID_ANTHROPIC_MODELS.forEach(model => {
      expect(isValidAnthropicModel(model)).toBe(true);
    });
  });
});

describe('BotState', () => {
  let state: BotState;

  beforeEach(() => {
    state = new BotState();
  });

  describe('getConfig', () => {
    it('should return default config for new guild', () => {
      const config = state.getConfig('guild123', false);
      expect(config.mode).toBe('jeeves');
      expect(config.messageLimit).toBe(20);
      expect(config.temperature).toBe(0.9);
      expect(config.maxResponseLength).toBe(1000);
      expect(config.shouldSaveData).toBe(true);
      expect(config.allowDMs).toBe(true);
      expect(config.learningEnabled).toBe(false);
    });

    it('should return default config for new DM user', () => {
      const config = state.getConfig('user123', true);
      expect(config.mode).toBe('jeeves');
      expect(config.messageLimit).toBe(20);
    });

    it('should return same config on subsequent calls', () => {
      const config1 = state.getConfig('guild123', false);
      const config2 = state.getConfig('guild123', false);
      expect(config1).toBe(config2);
    });

    it('should keep separate configs for guilds and DMs', () => {
      const guildConfig = state.getConfig('id123', false);
      const dmConfig = state.getConfig('id123', true);
      
      state.updateConfig('id123', false, { temperature: 0.5 });
      
      expect(state.getConfig('id123', false).temperature).toBe(0.5);
      expect(state.getConfig('id123', true).temperature).toBe(0.9);
    });
  });

  describe('updateConfig', () => {
    it('should update partial config', () => {
      state.updateConfig('guild123', false, { temperature: 0.5 });
      const config = state.getConfig('guild123', false);
      expect(config.temperature).toBe(0.5);
      expect(config.mode).toBe('jeeves'); // other values unchanged
    });

    it('should update multiple values at once', () => {
      state.updateConfig('guild123', false, {
        temperature: 0.5,
        mode: 'tokipona',
        messageLimit: 50
      });
      const config = state.getConfig('guild123', false);
      expect(config.temperature).toBe(0.5);
      expect(config.mode).toBe('tokipona');
      expect(config.messageLimit).toBe(50);
    });
  });

  describe('getBuffer', () => {
    it('should return empty buffer for new entity', () => {
      const buffer = state.getBuffer('guild123', false);
      expect(buffer.messages).toEqual([]);
      expect(buffer.responseTimer).toBeNull();
    });

    it('should return same buffer on subsequent calls', () => {
      const buffer1 = state.getBuffer('guild123', false);
      buffer1.messages.push({ role: 'user', content: 'test' });
      const buffer2 = state.getBuffer('guild123', false);
      expect(buffer2.messages).toHaveLength(1);
    });
  });

  describe('getLog', () => {
    it('should return empty log for new entity', () => {
      const log = state.getLog('guild123', false);
      expect(log.messages).toEqual([]);
    });

    it('should return same log on subsequent calls', () => {
      const log1 = state.getLog('guild123', false);
      log1.messages.push({ role: 'assistant', content: 'hello' });
      const log2 = state.getLog('guild123', false);
      expect(log2.messages).toHaveLength(1);
    });
  });

  describe('customPrompts', () => {
    it('should return default jeeves prompt when no custom prompt set', () => {
      const prompt = state.getCustomPrompt('guild123', false);
      expect(prompt).toContain('Jeeves');
    });

    it('should store and retrieve custom prompt', () => {
      state.setCustomPrompt('guild123', false, 'You are a pirate. Arrr!');
      const prompt = state.getCustomPrompt('guild123', false);
      expect(prompt).toBe('You are a pirate. Arrr!');
    });

    it('should keep separate prompts for guilds and DMs', () => {
      state.setCustomPrompt('id123', false, 'Guild prompt');
      state.setCustomPrompt('id123', true, 'DM prompt');
      
      expect(state.getCustomPrompt('id123', false)).toBe('Guild prompt');
      expect(state.getCustomPrompt('id123', true)).toBe('DM prompt');
    });
  });

  describe('reminders', () => {
    const createReminder = (id: string, userId: string) => ({
      id,
      userId,
      channelId: 'channel123',
      content: 'Test reminder',
      triggerTime: new Date(),
      isDM: false
    });

    it('should add and retrieve reminder', () => {
      const reminder = createReminder('rem1', 'user1');
      state.addReminder(reminder);
      
      expect(state.getReminder('rem1')).toBeDefined();
      expect(state.getReminder('rem1')?.content).toBe('Test reminder');
    });

    it('should get all reminders', () => {
      state.addReminder(createReminder('rem1', 'user1'));
      state.addReminder(createReminder('rem2', 'user2'));
      
      const all = state.getAllReminders();
      expect(all).toHaveLength(2);
    });

    it('should get reminders for specific user', () => {
      state.addReminder(createReminder('rem1', 'user1'));
      state.addReminder(createReminder('rem2', 'user1'));
      state.addReminder(createReminder('rem3', 'user2'));
      
      const user1Reminders = state.getRemindersForUser('user1');
      expect(user1Reminders).toHaveLength(2);
    });

    it('should remove reminder', () => {
      state.addReminder(createReminder('rem1', 'user1'));
      expect(state.getReminder('rem1')).toBeDefined();
      
      const deleted = state.removeReminder('rem1');
      expect(deleted).toBe(true);
      expect(state.getReminder('rem1')).toBeUndefined();
    });

    it('should return false when removing non-existent reminder', () => {
      const deleted = state.removeReminder('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('learningTracker', () => {
    it('should create new tracker for new entity', () => {
      const tracker = state.getLearningTracker('guild123', false);
      expect(tracker.lastQuestionTimes.size).toBe(0);
      expect(tracker.dailyQuestionCount.size).toBe(0);
    });

    it('should record question asked', () => {
      // Disable persistence for this test
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.recordQuestionAsked('guild123', false, 'Latin');
      
      const tracker = state.getLearningTracker('guild123', false);
      expect(tracker.lastQuestionTimes.get('Latin')).toBeDefined();
      expect(tracker.dailyQuestionCount.get('Latin')).toBe(1);
    });

    it('should increment daily count on multiple questions', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.recordQuestionAsked('guild123', false, 'Latin');
      state.recordQuestionAsked('guild123', false, 'Latin');
      state.recordQuestionAsked('guild123', false, 'Latin');
      
      const tracker = state.getLearningTracker('guild123', false);
      expect(tracker.dailyQuestionCount.get('Latin')).toBe(3);
    });

    it('should calculate time until next question', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      const subjects = ['Latin', 'toki pona'];
      
      // No questions asked yet - should be ready immediately
      const time = state.getTimeUntilNextQuestion('guild123', false, subjects);
      expect(time).toBe(0);
    });

    it('should return Infinity for empty subjects', () => {
      const time = state.getTimeUntilNextQuestion('guild123', false, []);
      expect(time).toBe(Infinity);
    });

    it('should get next question subject when due', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      const subjects = ['Latin', 'toki pona'];
      
      // No questions asked - should return a subject
      const next = state.getNextQuestionSubject('guild123', false, subjects);
      expect(subjects).toContain(next);
    });

    it('should return null for empty subjects', () => {
      const next = state.getNextQuestionSubject('guild123', false, []);
      expect(next).toBeNull();
    });
  });

  describe('reactionTracker', () => {
    it('should create new tracker for new entity', () => {
      const tracker = state.getReactionTracker('guild123', false);
      expect(tracker.recentReactions).toEqual([]);
    });

    it('should record reactions', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.recordReaction('guild123', false, '👍', 'Great post!', 'channel1');
      
      const reactions = state.getRecentReactions('guild123', false);
      expect(reactions).toHaveLength(1);
      expect(reactions[0].emoji).toBe('👍');
      expect(reactions[0].messageContent).toBe('Great post!');
    });

    it('should limit to 5 recent reactions', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      for (let i = 0; i < 7; i++) {
        state.recordReaction('guild123', false, `emoji${i}`, `msg${i}`, 'channel1');
      }
      
      const reactions = state.getRecentReactions('guild123', false);
      expect(reactions).toHaveLength(5);
      // Most recent should be first
      expect(reactions[0].emoji).toBe('emoji6');
    });

    it('should truncate long message content', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      const longMessage = 'a'.repeat(200);
      
      state.recordReaction('guild123', false, '👍', longMessage, 'channel1');
      
      const reactions = state.getRecentReactions('guild123', false);
      expect(reactions[0].messageContent.length).toBeLessThanOrEqual(103); // 100 + '...'
    });
  });

  describe('channelMemberships', () => {
    it('should set and get channel membership', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.setChannelMembership('guild123', false, 'channel1', {
        responseFrequency: ResponseFrequency.EveryMessage
      });
      
      const membership = state.getChannelMembership('guild123', false, 'channel1');
      expect(membership?.responseFrequency).toBe('all');
    });

    it('should return undefined for non-configured channel', () => {
      const membership = state.getChannelMembership('guild123', false, 'unknown');
      expect(membership).toBeUndefined();
    });

    it('should remove channel membership', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.setChannelMembership('guild123', false, 'channel1', {
        responseFrequency: ResponseFrequency.WhenMentioned
      });
      
      const deleted = state.removeChannelMembership('guild123', false, 'channel1');
      expect(deleted).toBe(true);
      expect(state.getChannelMembership('guild123', false, 'channel1')).toBeUndefined();
    });

    it('should get all channel memberships', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.setChannelMembership('guild123', false, 'ch1', { responseFrequency: ResponseFrequency.EveryMessage });
      state.setChannelMembership('guild123', false, 'ch2', { responseFrequency: ResponseFrequency.None });
      
      const all = state.getAllChannelMemberships('guild123', false);
      expect(all.size).toBe(2);
    });
  });

  describe('autotranslateChannels', () => {
    it('should add autotranslate channel', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.addAutotranslateChannel('guild123', false, 'channel1', 'Spanish');
      
      const language = state.getAutotranslateLanguage('guild123', false, 'channel1');
      expect(language).toBe('Spanish');
    });

    it('should update existing autotranslate channel', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.addAutotranslateChannel('guild123', false, 'channel1', 'Spanish');
      state.addAutotranslateChannel('guild123', false, 'channel1', 'French');
      
      const language = state.getAutotranslateLanguage('guild123', false, 'channel1');
      expect(language).toBe('French');
    });

    it('should return null for non-configured channel', () => {
      const language = state.getAutotranslateLanguage('guild123', false, 'unknown');
      expect(language).toBeNull();
    });

    it('should remove autotranslate channel', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.addAutotranslateChannel('guild123', false, 'channel1', 'Latin');
      
      const removed = state.removeAutotranslateChannel('guild123', false, 'channel1');
      expect(removed).toBe(true);
      expect(state.getAutotranslateLanguage('guild123', false, 'channel1')).toBeNull();
    });

    it('should return false when removing non-existent channel', () => {
      const removed = state.removeAutotranslateChannel('guild123', false, 'nonexistent');
      expect(removed).toBe(false);
    });

    it('should get all autotranslate channels', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.addAutotranslateChannel('guild123', false, 'ch1', 'Spanish');
      state.addAutotranslateChannel('guild123', false, 'ch2', 'French');
      
      const all = state.getAllAutotranslateChannels('guild123', false);
      expect(all).toHaveLength(2);
    });
  });

  describe('autotranslateUsers', () => {
    it('should add autotranslate user', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.addAutotranslateUser('guild123', false, 'user1', 'Latin');
      
      const languages = state.getAutotranslateUserLanguages('guild123', false, 'user1');
      expect(languages).toContain('Latin');
    });

    it('should allow multiple languages per user', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.addAutotranslateUser('guild123', false, 'user1', 'Latin');
      state.addAutotranslateUser('guild123', false, 'user1', 'Greek');
      
      const languages = state.getAutotranslateUserLanguages('guild123', false, 'user1');
      expect(languages).toHaveLength(2);
      expect(languages).toContain('Latin');
      expect(languages).toContain('Greek');
    });

    it('should not duplicate same language for user', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.addAutotranslateUser('guild123', false, 'user1', 'Latin');
      state.addAutotranslateUser('guild123', false, 'user1', 'latin'); // case insensitive check
      
      const languages = state.getAutotranslateUserLanguages('guild123', false, 'user1');
      expect(languages).toHaveLength(1);
    });

    it('should remove specific language for user', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.addAutotranslateUser('guild123', false, 'user1', 'Latin');
      state.addAutotranslateUser('guild123', false, 'user1', 'Greek');
      
      const removed = state.removeAutotranslateUser('guild123', false, 'user1', 'Latin');
      expect(removed).toBe(true);
      
      const languages = state.getAutotranslateUserLanguages('guild123', false, 'user1');
      expect(languages).toHaveLength(1);
      expect(languages).toContain('Greek');
    });

    it('should remove all languages for user', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.addAutotranslateUser('guild123', false, 'user1', 'Latin');
      state.addAutotranslateUser('guild123', false, 'user1', 'Greek');
      
      const removed = state.removeAutotranslateUser('guild123', false, 'user1');
      expect(removed).toBe(true);
      
      const languages = state.getAutotranslateUserLanguages('guild123', false, 'user1');
      expect(languages).toHaveLength(0);
    });

    it('should get all autotranslate users', () => {
      state.updateConfig('guild123', false, { shouldSaveData: false });
      
      state.addAutotranslateUser('guild123', false, 'user1', 'Latin');
      state.addAutotranslateUser('guild123', false, 'user2', 'Greek');
      
      const all = state.getAllAutotranslateUsers('guild123', false);
      expect(all).toHaveLength(2);
    });
  });
});
