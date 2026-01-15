import { help } from './help';

describe('help', () => {
  it('should be an array of strings', () => {
    expect(Array.isArray(help)).toBe(true);
    help.forEach(item => {
      expect(typeof item).toBe('string');
    });
  });

  it('should contain multiple help sections', () => {
    expect(help.length).toBeGreaterThan(1);
  });

  it('should contain command documentation', () => {
    const allHelp = help.join('');
    expect(allHelp).toContain('!help');
    expect(allHelp).toContain('!clear');
    expect(allHelp).toContain('!jeeves');
  });

  it('should document all main modes', () => {
    const allHelp = help.join('');
    expect(allHelp).toContain('!jeeves');
    expect(allHelp).toContain('!tokipona');
    expect(allHelp).toContain('!whisper');
  });

  it('should document configuration commands', () => {
    const allHelp = help.join('');
    expect(allHelp).toContain('!temperature');
    expect(allHelp).toContain('!model');
    expect(allHelp).toContain('!delay');
    expect(allHelp).toContain('!tokens');
    expect(allHelp).toContain('!limit');
  });

  it('should document muse commands', () => {
    const allHelp = help.join('');
    expect(allHelp).toContain('!muse');
    expect(allHelp).toContain('!museon');
    expect(allHelp).toContain('!museoff');
  });

  it('should document reminder commands', () => {
    const allHelp = help.join('');
    expect(allHelp).toContain('!remind');
    expect(allHelp).toContain('!reminders');
    expect(allHelp).toContain('!cancelreminder');
  });

  it('should document learning commands', () => {
    const allHelp = help.join('');
    expect(allHelp).toContain('!learnon');
    expect(allHelp).toContain('!learnoff');
    expect(allHelp).toContain('!learnadd');
  });

  it('should document autotranslate commands', () => {
    const allHelp = help.join('');
    expect(allHelp).toContain('!translateadd');
    expect(allHelp).toContain('!translateremove');
    expect(allHelp).toContain('!translatelist');
  });

  it('should document voice commands section', () => {
    const allHelp = help.join('');
    expect(allHelp).toContain('Voice Commands');
  });
});
