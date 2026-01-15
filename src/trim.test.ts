import trim from './trim';

describe('trim', () => {
  it('should collapse multiple newlines into single newlines', () => {
    expect(trim('hello\n\n\nworld')).toBe('hello\nworld');
    expect(trim('hello\n\nworld')).toBe('hello\nworld');
  });

  it('should collapse multiple spaces into single space', () => {
    expect(trim('hello    world')).toBe('hello world');
    expect(trim('hello  world')).toBe('hello world');
  });

  it('should remove tabs and carriage returns', () => {
    expect(trim('hello\t\tworld')).toBe('hello world');
    expect(trim('hello\r\rworld')).toBe('hello world');
    expect(trim('hello\t\r world')).toBe('hello world');
  });

  it('should handle newlines with whitespace', () => {
    expect(trim('hello\n   \nworld')).toBe('hello\nworld');
    expect(trim('hello\n\t\nworld')).toBe('hello\nworld');
  });

  it('should handle empty strings', () => {
    expect(trim('')).toBe('');
  });

  it('should handle strings with only whitespace', () => {
    expect(trim('   ')).toBe(' ');
    expect(trim('\t\t')).toBe(' ');
  });

  it('should preserve single newlines', () => {
    expect(trim('hello\nworld')).toBe('hello\nworld');
  });

  it('should handle mixed whitespace types', () => {
    expect(trim('hello \t  \r world')).toBe('hello world');
  });

  it('should handle complex real-world text', () => {
    const input = `
      Title: Some Page




      This is   some text with   extra spaces

      And more text
    `;
    const result = trim(input);
    // Should collapse multiple newlines and spaces
    expect(result).not.toContain('\n\n');
    expect(result).not.toContain('  ');
  });
});
