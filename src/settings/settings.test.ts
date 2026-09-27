import { BotState } from '../state';
import {
  SETTINGS, getSetting, parseSettingValue, formatSetting, describeSettingsForAgent, NumberSetting
} from './schema';
import { buildSettingsPanel, buildProposalMessage, handleSettingsInteraction } from './panel';
import { interactionPermissionError } from '../commands/utils';
import { createProposeSettingTool } from '../llm/tools';
import { SettingProposal } from './schema';

jest.mock('fs', () => ({
  promises: {
    readdir: jest.fn().mockResolvedValue([]),
    readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined)
  },
  readFileSync: jest.fn().mockReturnValue('mock prompt content')
}));

jest.mock('../getWebpage', () => ({ getWebpage: jest.fn() }));

jest.mock('../commands/config', () => ({
  getValidModels: jest.fn().mockResolvedValue([
    'claude-sonnet-4-5', 'claude-opus-4-1', 'grok-4.5', 'grok-4', 'poolside/laguna-xs-2.1'
  ])
}));

const num = (key: string) => getSetting(key) as NumberSetting;

describe('settings schema', () => {
  const defaults = new BotState().getConfig('g', false);

  it('every setting points at a BotConfig field of the right type', () => {
    for (const s of SETTINGS) {
      expect(typeof defaults[s.key]).toBe({ toggle: 'boolean', number: 'number', choice: 'string' }[s.kind]);
      if (s.kind === 'choice') expect(s.options.map(o => o.value)).toContain(defaults[s.key]);
    }
  });

  it('parses choices by value or label, case-insensitively', () => {
    const effort = getSetting('thinkingEffort')!;
    expect(parseSettingValue(effort, 'XHIGH')).toEqual({ ok: true, value: 'xhigh' });
    expect(parseSettingValue(effort, 'Extra high')).toEqual({ ok: true, value: 'xhigh' });
    expect(parseSettingValue(effort, 'ludicrous')).toMatchObject({ ok: false, error: expect.stringContaining('Effort') });
    expect(formatSetting(effort, { ...defaults, thinkingEffort: 'max' })).toBe('Max');
  });

  it('parses numbers in display units and stores scaled values', () => {
    expect(parseSettingValue(num('responseDelayMs'), '5.4')).toEqual({ ok: true, value: 5000 });
    expect(parseSettingValue(num('museInterval'), '12')).toEqual({ ok: true, value: 12 * 60 * 60 * 1000 });
    expect(parseSettingValue(num('temperature'), '2')).toEqual({ ok: true, value: 2 });
  });

  it('rejects out-of-range, non-integer and empty input', () => {
    expect(parseSettingValue(num('temperature'), '0').ok).toBe(false);   // exclusive minimum
    expect(parseSettingValue(num('temperature'), '2.1').ok).toBe(false);
    expect(parseSettingValue(num('webSearchMaxUses'), '21').ok).toBe(false);
    expect(parseSettingValue(num('messageLimit'), '2.5').ok).toBe(false);
    expect(parseSettingValue(num('maxResponseLength'), '').ok).toBe(false);
    expect(parseSettingValue(num('maxResponseLength'), 'lots').ok).toBe(false);
  });

  it('parses toggles leniently', () => {
    const search = getSetting('webSearchEnabled')!;
    expect(parseSettingValue(search, 'on')).toEqual({ ok: true, value: true });
    expect(parseSettingValue(search, false)).toEqual({ ok: true, value: false });
    expect(parseSettingValue(search, 'maybe').ok).toBe(false);
  });

  it('formats values with units', () => {
    expect(formatSetting(num('responseDelayMs'), { ...defaults, responseDelayMs: 5000 })).toBe('5 seconds');
    expect(formatSetting(getSetting('extendedThinking')!, { ...defaults, extendedThinking: true })).toBe('on');
  });

  it('only mentions the proposal tool when proposals are allowed', () => {
    expect(describeSettingsForAgent(defaults, false)).not.toContain('propose_setting_change');
    expect(describeSettingsForAgent(defaults, true)).toContain('propose_setting_change');
    expect(describeSettingsForAgent(defaults, false)).toContain(`Model: ${defaults.model}`);
  });
});

describe('settings panel', () => {
  const allButtons = (payload: any) =>
    payload.components.flatMap((row: any) => row.toJSON().components).filter((c: any) => c.type === 2);

  it('renders toggles as checkboxes and stays within Discord limits', async () => {
    const state = new BotState();
    state.updateConfig('g', false, { webSearchEnabled: true, extendedThinking: false });
    for (const tab of ['chat', 'features', 'admin'] as const) {
      const payload = await buildSettingsPanel(state, 'g', false, tab);
      expect(payload.components.length).toBeLessThanOrEqual(5);
      for (const row of payload.components) {
        expect(row.toJSON().components.length).toBeLessThanOrEqual(5);
      }
    }
    const chat = await buildSettingsPanel(state, 'g', false, 'chat');
    const search = allButtons(chat).find((b: any) => b.custom_id === 'cfg:t:webSearchEnabled');
    const think = allButtons(chat).find((b: any) => b.custom_id === 'cfg:t:extendedThinking');
    expect(search).toMatchObject({ style: 3, emoji: { name: '✅' } });  // Success
    expect(think).toMatchObject({ style: 2, emoji: { name: '⬜' } });   // Secondary
    const menus = chat.components.flatMap((row: any) => row.toJSON().components).filter((c: any) => c.type === 3);
    const effort = menus.find((m: any) => m.custom_id === 'cfg:c:thinkingEffort');
    expect(effort.options.find((o: any) => o.default).value).toBe('auto');
  });

  it('falls back to static models when the live list is slow', async () => {
    const { getValidModels } = jest.requireMock('../commands/config');
    getValidModels.mockImplementationOnce(() => new Promise(() => {})); // never resolves
    const payload = await buildSettingsPanel(new BotState(), 'g', false, 'chat');
    const modelMenu = payload.components[1].toJSON().components[0] as any;
    expect(modelMenu.options.length).toBeGreaterThan(1);
  });

  it('hides guild-only settings in DMs', async () => {
    const state = new BotState();
    const ids = [
      ...allButtons(await buildSettingsPanel(state, 'u', true, 'features')),
      ...allButtons(await buildSettingsPanel(state, 'u', true, 'admin'))
    ].map((b: any) => b.custom_id);
    expect(ids).not.toContain('cfg:t:reactionModeEnabled');
    expect(ids).not.toContain('cfg:t:adminMode');
    expect(ids).toContain('cfg:t:useVoiceResponse');
  });
});

function fakeInteraction(customId: string, opts: {
  dm?: boolean; admin?: boolean; kind?: 'button' | 'select' | 'modal';
  values?: string[]; fields?: Record<string, string>;
} = {}) {
  const kind = opts.kind ?? 'button';
  const guildId = opts.dm ? null : 'g';
  return {
    customId,
    guildId,
    user: { id: 'u', username: 'tester', displayName: 'Tester' },
    inGuild: () => guildId !== null,
    memberPermissions: guildId ? { has: () => !!opts.admin } : null,
    isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select',
    isModalSubmit: () => kind === 'modal',
    isFromMessage: () => true,
    values: opts.values ?? [],
    fields: {
      getTextInputValue: (k: string) => {
        if (!opts.fields || !(k in opts.fields)) throw new Error('missing');
        return opts.fields[k];
      }
    },
    message: { embeds: [] },
    update: jest.fn(), reply: jest.fn(), followUp: jest.fn(), showModal: jest.fn()
  } as any;
}

describe('handleSettingsInteraction', () => {
  let state: BotState;
  beforeEach(() => { state = new BotState(); });

  it('flips a toggle and re-renders with a last-change footer', async () => {
    const i = fakeInteraction('cfg:t:webSearchEnabled');
    const before = state.getConfig('g', false).webSearchEnabled;
    await handleSettingsInteraction(i, state);
    expect(state.getConfig('g', false).webSearchEnabled).toBe(!before);
    const embed = i.update.mock.calls[0][0].embeds[0].toJSON();
    expect(embed.footer.text).toContain('Tester turned Web search');
  });

  it('refuses non-admins when admin mode is on, unless settings is whitelisted', async () => {
    state.updateConfig('g', false, { adminMode: true });
    const denied = fakeInteraction('cfg:t:webSearchEnabled');
    await handleSettingsInteraction(denied, state);
    expect(denied.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(denied.update).not.toHaveBeenCalled();

    state.updateConfig('g', false, { commandWhitelist: ['settings'] });
    const allowed = fakeInteraction('cfg:t:webSearchEnabled');
    await handleSettingsInteraction(allowed, state);
    expect(allowed.update).toHaveBeenCalled();
  });

  it('always requires a real admin for admin mode itself', () => {
    const opts = { requiresAdmin: getSetting('adminMode')!.requiresAdmin, command: 'settings' };
    const config = state.getConfig('g', false);
    expect(interactionPermissionError(fakeInteraction('x'), config, opts)).toMatch(/administrators/);
    expect(interactionPermissionError(fakeInteraction('x', { admin: true }), config, opts)).toBeNull();
  });

  it('switches persona from the dropdown, starting the context afresh', async () => {
    const before = Date.now();
    await handleSettingsInteraction(fakeInteraction('cfg:mode', { kind: 'select', values: ['tokipona'] }), state);
    expect(state.getConfig('g', false).mode).toBe('tokipona');
    expect(state.getConfig('g', false).contextResetAt).toBeGreaterThanOrEqual(before);
  });

  it('sets a choice from its dropdown', async () => {
    const i = fakeInteraction('cfg:c:thinkingEffort', { kind: 'select', values: ['xhigh'] });
    await handleSettingsInteraction(i, state);
    expect(state.getConfig('g', false).thinkingEffort).toBe('xhigh');
    expect(i.update.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('set Effort to Extra high');
  });

  it('applies valid numbers from the form and reports invalid ones', async () => {
    const i = fakeInteraction('cfg:modal:chat', {
      kind: 'modal',
      fields: { temperature: '0.3', maxResponseLength: 'huge', messageLimit: '40', responseDelayMs: '2', webSearchMaxUses: '5' }
    });
    const originalMax = state.getConfig('g', false).maxResponseLength;
    await handleSettingsInteraction(i, state);
    const config = state.getConfig('g', false);
    expect(config.temperature).toBe(0.3);
    expect(config.messageLimit).toBe(40);
    expect(config.responseDelayMs).toBe(2000);
    expect(config.maxResponseLength).toBe(originalMax);
    expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Max response') }));
  });

  it('applies a proposal on click and closes it', async () => {
    const i = fakeInteraction('cfg:prop:maxResponseLength:4000');
    await handleSettingsInteraction(i, state);
    expect(state.getConfig('g', false).maxResponseLength).toBe(4000);
    const payload = i.update.mock.calls[0][0];
    expect(payload.components).toEqual([]);
    expect(payload.embeds[0].toJSON().footer.text).toContain('Applied by Tester');
  });

  it('ignores proposals for settings agents may not propose', async () => {
    const i = fakeInteraction('cfg:prop:adminMode:on');
    await handleSettingsInteraction(i, state);
    expect(state.getConfig('g', false).adminMode).toBe(false);
    expect(i.update).not.toHaveBeenCalled();
  });
});

describe('propose_setting_change tool', () => {
  const config = new BotState().getConfig('g', false);

  it('queues one validated proposal in display units', async () => {
    const proposals: SettingProposal[] = [];
    const tool = createProposeSettingTool({ ...config, webSearchEnabled: false }, proposals);
    const out = await tool.run({ setting: 'webSearchEnabled', value: 'on', reason: 'News moves fast, sir.' });
    expect(out).toContain('Queued');
    expect(proposals).toEqual([{ key: 'webSearchEnabled', value: true, reason: 'News moves fast, sir.' }]);
    await expect(tool.run({ setting: 'maxResponseLength', value: '4000', reason: 'x' })).rejects.toThrow(/one suggestion/);
  });

  it('rejects settings agents may not propose, and invalid values', async () => {
    const tool = createProposeSettingTool(config, []);
    await expect(tool.run({ setting: 'adminMode', value: 'on', reason: 'x' })).rejects.toThrow(/Not a setting/);
    await expect(tool.run({ setting: 'webSearchMaxUses', value: '99', reason: 'x' })).rejects.toThrow(/Searches per reply/);
  });

  it('queues a choice proposal that the Apply button can carry', async () => {
    const proposals: SettingProposal[] = [];
    const tool = createProposeSettingTool(config, proposals);
    await tool.run({ setting: 'thinkingEffort', value: 'max', reason: 'A knotty question, sir.' });
    expect(proposals[0]).toMatchObject({ key: 'thinkingEffort', value: 'max' });
    const i = fakeInteraction('cfg:prop:thinkingEffort:max');
    const state = new BotState();
    await handleSettingsInteraction(i, state);
    expect(state.getConfig('g', false).thinkingEffort).toBe('max');
  });

  it('does not queue a no-op', async () => {
    const proposals: SettingProposal[] = [];
    const tool = createProposeSettingTool({ ...config, extendedThinking: true }, proposals);
    expect(await tool.run({ setting: 'extendedThinking', value: 'on', reason: 'x' })).toContain('already');
    expect(proposals).toEqual([]);
  });

  it('builds a proposal message whose Apply button carries the change', () => {
    const payload = buildProposalMessage({ key: 'maxResponseLength', value: 4000, reason: 'A fuller answer.' }, 'jeeves');
    const buttons = payload.components[0].toJSON().components as any[];
    expect(buttons.map(b => b.custom_id)).toEqual(['cfg:prop:maxResponseLength:4000', 'cfg:nope']);
    expect(payload.embeds[0].toJSON().title).toContain('Jeeves suggests');
  });
});
