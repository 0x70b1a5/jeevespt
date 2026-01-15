import { prependTimestampAndUsername, extractEmbedDataToText, extractTranslatableEmbedContent } from './formatMessage';
import { Message, GuildMember, User, Embed } from 'discord.js';

// Mock dayjs to return consistent timestamps
jest.mock('dayjs', () => {
  return () => ({
    format: () => '01/15/2026 10:30:45'
  });
});

// Helper to create mock embed parts
interface MockEmbedParts {
  url?: string;
  title?: string;
  description?: string;
  author?: { name: string };
  footer?: { text: string };
  provider?: { name: string };
}

// Helper to create mock messages
function createMockMessage(options: {
  username?: string;
  displayName?: string;
  cleanContent?: string;
  createdTimestamp?: number;
  embeds?: MockEmbedParts[];
}): Message {
  const mockUser = {
    username: options.username || 'testuser'
  } as User;

  const mockMember = options.displayName ? {
    displayName: options.displayName
  } as GuildMember : null;

  return {
    author: mockUser,
    member: mockMember,
    cleanContent: options.cleanContent !== undefined ? options.cleanContent : 'Hello world',
    createdTimestamp: options.createdTimestamp || Date.now(),
    embeds: (options.embeds || []) as unknown as Embed[]
  } as Message;
}

describe('prependTimestampAndUsername', () => {
  it('should format message with username only when no display name', () => {
    const message = createMockMessage({ username: 'johndoe' });
    const result = prependTimestampAndUsername(message);
    expect(result).toBe('01/15/2026 10:30:45 [johndoe]: Hello world');
  });

  it('should include display name when different from username', () => {
    const message = createMockMessage({
      username: 'johndoe',
      displayName: 'John Doe'
    });
    const result = prependTimestampAndUsername(message);
    expect(result).toBe('01/15/2026 10:30:45 [johndoe/John Doe]: Hello world');
  });

  it('should use username only when display name matches username', () => {
    const message = createMockMessage({
      username: 'johndoe',
      displayName: 'johndoe'
    });
    const result = prependTimestampAndUsername(message);
    expect(result).toBe('01/15/2026 10:30:45 [johndoe]: Hello world');
  });

  it('should handle message content correctly', () => {
    const message = createMockMessage({
      username: 'user1',
      cleanContent: 'This is a test message with special chars: !@#$%'
    });
    const result = prependTimestampAndUsername(message);
    expect(result).toContain('This is a test message with special chars: !@#$%');
  });

  it('should handle empty content', () => {
    const message = createMockMessage({
      username: 'user1',
      cleanContent: ''
    });
    const result = prependTimestampAndUsername(message);
    expect(result).toBe('01/15/2026 10:30:45 [user1]: ');
  });
});

describe('extractEmbedDataToText', () => {
  it('should return empty string for message with no embeds', () => {
    const message = createMockMessage({ embeds: [] });
    const result = extractEmbedDataToText(message);
    expect(result).toBe('');
  });

  it('should extract URL from embed', () => {
    const message = createMockMessage({
      embeds: [{ url: 'https://example.com' }]
    });
    const result = extractEmbedDataToText(message);
    expect(result).toContain('https://example.com');
  });

  it('should extract title from embed', () => {
    const message = createMockMessage({
      embeds: [{ title: 'Test Title' }]
    });
    const result = extractEmbedDataToText(message);
    expect(result).toContain('Test Title');
  });

  it('should extract description from embed', () => {
    const message = createMockMessage({
      embeds: [{ description: 'This is a description' }]
    });
    const result = extractEmbedDataToText(message);
    expect(result).toContain('This is a description');
  });

  it('should extract author name from embed', () => {
    const message = createMockMessage({
      embeds: [{ author: { name: 'Author Name' } }]
    });
    const result = extractEmbedDataToText(message);
    expect(result).toContain('Author Name');
  });

  it('should extract provider name from embed', () => {
    const message = createMockMessage({
      embeds: [{ provider: { name: 'Provider Name' } }]
    });
    const result = extractEmbedDataToText(message);
    expect(result).toContain('Provider Name');
  });

  it('should extract footer text from embed', () => {
    const message = createMockMessage({
      embeds: [{ footer: { text: 'Footer Text' } }]
    });
    const result = extractEmbedDataToText(message);
    expect(result).toContain('Footer Text');
  });

  it('should extract all fields from embed', () => {
    const message = createMockMessage({
      embeds: [{
        url: 'https://example.com',
        title: 'Title',
        description: 'Description',
        author: { name: 'Author' },
        footer: { text: 'Footer' }
      }]
    });
    const result = extractEmbedDataToText(message);
    expect(result).toContain('https://example.com');
    expect(result).toContain('Title');
    expect(result).toContain('Description');
    expect(result).toContain('Author');
    expect(result).toContain('Footer');
  });

  it('should handle multiple embeds', () => {
    const message = createMockMessage({
      embeds: [
        { title: 'First Embed' },
        { title: 'Second Embed' }
      ]
    });
    const result = extractEmbedDataToText(message);
    expect(result).toContain('First Embed');
    expect(result).toContain('Second Embed');
  });
});

describe('extractTranslatableEmbedContent', () => {
  it('should return empty string for message with no embeds', () => {
    const message = createMockMessage({ embeds: [] });
    const result = extractTranslatableEmbedContent(message);
    expect(result).toBe('');
  });

  it('should extract description from embed', () => {
    const message = createMockMessage({
      embeds: [{ description: 'Translatable content' }]
    });
    const result = extractTranslatableEmbedContent(message);
    expect(result).toContain('Translatable content');
  });

  it('should extract title when not a URL', () => {
    const message = createMockMessage({
      embeds: [{ title: 'A Normal Title' }]
    });
    const result = extractTranslatableEmbedContent(message);
    expect(result).toContain('A Normal Title');
  });

  it('should skip title when it is a URL', () => {
    const message = createMockMessage({
      embeds: [{ title: 'https://example.com/page' }]
    });
    const result = extractTranslatableEmbedContent(message);
    expect(result).not.toContain('https://');
  });

  it('should skip title when it looks like a domain', () => {
    const message = createMockMessage({
      embeds: [{ title: 'example.com' }]
    });
    const result = extractTranslatableEmbedContent(message);
    expect(result).toBe('');
  });

  it('should NOT include URL, provider, author, or footer', () => {
    const message = createMockMessage({
      embeds: [{
        url: 'https://example.com',
        provider: { name: 'Provider' },
        author: { name: 'Author' },
        footer: { text: 'Footer' }
      }]
    });
    const result = extractTranslatableEmbedContent(message);
    expect(result).not.toContain('https://');
    expect(result).not.toContain('Provider');
    expect(result).not.toContain('Author');
    expect(result).not.toContain('Footer');
  });
});
