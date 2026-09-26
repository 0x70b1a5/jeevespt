/**
 * Discord UI for settings: the `/settings` panel and agents' setting proposals.
 *
 * Both are ordinary public messages whose buttons/menus carry everything they
 * need in their custom_id (`cfg:…`), the same trick Joblin uses — so panels and
 * proposals keep working after a restart with no per-message bookkeeping. The
 * scope (guild or DM) comes from where the interaction happened.
 *
 *   cfg:tab:<tab>          switch panel tab
 *   cfg:t:<key>            flip a toggle
 *   cfg:mode / cfg:model   persona / model dropdowns
 *   cfg:num:<tab>          open the numbers form → submits as cfg:modal:<tab>
 *   cfg:prop:<key>:<value> apply an agent's proposal  (cfg:nope dismisses it)
 */

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    EmbedBuilder,
    Interaction,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import {
    BotConfig, BotMode, BotState, isPoolsideModel, isXaiModel,
    VALID_ANTHROPIC_MODELS, VALID_POOLSIDE_MODELS, VALID_XAI_MODELS
} from '../state';
import { JEEVES_PROMPT } from '../prompts/prompts';
import { PERSONAS } from '../commands/constants';
import { getValidModels } from '../commands/config';
import {
    applyMode, applySetting, describeChange, displayNumber, formatSetting, getSetting, NumberSetting,
    parseSettingValue, Setting, SettingProposal, SettingTab, settingsForTab
} from './schema';

const TABS: { id: SettingTab; label: string; emoji: string }[] = [
    { id: 'chat', label: 'Chat', emoji: '💬' },
    { id: 'features', label: 'Features', emoji: '✨' },
    { id: 'admin', label: 'Admin', emoji: '🛡️' }
];

const PERSONA_OPTIONS: { mode: BotMode; label: string; description: string; emoji: string }[] = [
    { mode: 'jeeves', label: 'Jeeves', description: 'The cultured butler', emoji: '🎩' },
    { mode: 'tokipona', label: 'toki pona', description: 'Language immersion', emoji: '🗣️' },
    { mode: 'lugso', label: 'Lugso', description: 'The Lugso persona', emoji: '🐙' },
    { mode: 'whisper', label: 'Whisper', description: 'Transcription only, no chat', emoji: '🎙️' },
    { mode: 'customprompt', label: 'Custom prompt', description: 'The prompt set with !prompt', emoji: '📝' }
];

const DEFAULT_FOOTER = 'Anyone here may change these unless admin mode is on · changes apply immediately';
const PANEL_COLOR = 0x2b6cb0;
const MODEL_MENU_LIMIT = 25; // Discord's cap on select-menu options

type Payload = { embeds: EmbedBuilder[]; components: ActionRowBuilder<any>[] };

// ── Panel rendering ─────────────────────────────────────────────────────

export async function buildSettingsPanel(
    state: BotState,
    id: string,
    isDM: boolean,
    tab: SettingTab = 'chat',
    footer = DEFAULT_FOOTER
): Promise<Payload> {
    const config = state.getConfig(id, isDM);
    const settings = settingsForTab(tab, isDM);
    const tabInfo = TABS.find(t => t.id === tab)!;

    const lines: string[] = [];
    if (tab === 'chat') {
        const persona = PERSONA_OPTIONS.find(p => p.mode === config.mode);
        lines.push(`${persona?.emoji ?? '🎭'} **Persona:** ${persona?.label ?? config.mode}  ·  🤖 **Model:** \`${config.model}\``, '');
    }
    for (const s of settings) {
        lines.push(`${s.emoji} **${s.label}:** ${formatSetting(s, config)} — *${s.description}*`);
    }
    if (tab === 'admin' && !isDM) {
        const list = config.commandWhitelist.length ? config.commandWhitelist.map(c => `\`${c}\``).join(', ') : 'none';
        lines.push('', `**Whitelisted for non-admins:** ${list} (manage with \`!whitelist\`; whitelist \`settings\` to open this panel to everyone)`);
    }

    const embed = new EmbedBuilder()
        .setColor(PANEL_COLOR)
        .setTitle(`⚙️ Settings · ${tabInfo.emoji} ${tabInfo.label}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: footer });

    const components: ActionRowBuilder<any>[] = [];
    if (tab === 'chat') {
        components.push(personaMenu(state, id, isDM, config), await modelMenu(config));
    }
    const buttons = settings.filter(s => s.kind === 'toggle').map(s => toggleButton(s, config));
    if (settings.some(s => s.kind === 'number')) {
        buttons.push(new ButtonBuilder().setCustomId(`cfg:num:${tab}`).setLabel('Numbers…').setEmoji('✏️').setStyle(ButtonStyle.Primary));
    }
    if (buttons.length) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
    components.push(tabRow(tab));

    return { embeds: [embed], components };
}

/** Checkbox-style: green with ✅ when on, grey with ⬜ when off. */
function toggleButton(setting: Setting, config: BotConfig): ButtonBuilder {
    const on = Boolean(config[setting.key]);
    return new ButtonBuilder()
        .setCustomId(`cfg:t:${setting.key}`)
        .setLabel(setting.label)
        .setEmoji(on ? '✅' : '⬜')
        .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
}

function tabRow(current: SettingTab): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(TABS.map(t =>
        new ButtonBuilder()
            .setCustomId(`cfg:tab:${t.id}`)
            .setLabel(t.label)
            .setEmoji(t.emoji)
            .setStyle(t.id === current ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(t.id === current)
    ));
}

function personaMenu(state: BotState, id: string, isDM: boolean, config: BotConfig): ActionRowBuilder<StringSelectMenuBuilder> {
    // Custom prompt is only selectable once one has been set with !prompt.
    const hasCustom = config.mode === 'customprompt' || state.getCustomPrompt(id, isDM) !== JEEVES_PROMPT;
    const menu = new StringSelectMenuBuilder()
        .setCustomId('cfg:mode')
        .setPlaceholder('Persona')
        .addOptions(PERSONA_OPTIONS
            .filter(p => p.mode !== 'customprompt' || hasCustom)
            .map(p => ({
                label: p.label,
                value: p.mode,
                description: `${p.description} (clears memory)`,
                emoji: p.emoji,
                default: p.mode === config.mode
            })));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/**
 * Live model lists are cached for 5 minutes; a cold fetch hits three APIs.
 * Discord wants a component response within 3s, so don't wait long — fall
 * back to the static lists (the live fetch still fills the cache for next time).
 */
async function modelsWithinDeadline(ms = 1500): Promise<string[]> {
    const fallback = [...VALID_ANTHROPIC_MODELS, ...VALID_XAI_MODELS, ...VALID_POOLSIDE_MODELS];
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<string[]>(resolve => { timer = setTimeout(() => resolve(fallback), ms); });
    try {
        return await Promise.race([getValidModels(), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

async function modelMenu(config: BotConfig): Promise<ActionRowBuilder<StringSelectMenuBuilder>> {
    const all = await modelsWithinDeadline();
    const claude = all.filter(m => !isXaiModel(m) && !isPoolsideModel(m));
    const grok = all.filter(isXaiModel);
    const poolside = all.filter(isPoolsideModel);
    // Newest-first lists; keep every provider represented within the 25 cap.
    const picked = [...new Set([
        config.model,
        ...poolside.slice(0, 3),
        ...grok.slice(0, 7),
        ...claude
    ])].slice(0, MODEL_MENU_LIMIT);
    const provider = (m: string) => isXaiModel(m) ? 'xAI Grok' : isPoolsideModel(m) ? 'Poolside' : 'Anthropic Claude';
    const order = (m: string) => isXaiModel(m) ? 1 : isPoolsideModel(m) ? 2 : 0;
    picked.sort((a, b) => order(a) - order(b));

    const menu = new StringSelectMenuBuilder()
        .setCustomId('cfg:model')
        .setPlaceholder('Model')
        .addOptions(picked.map(m => ({
            label: m.slice(0, 100),
            value: m.slice(0, 100),
            description: provider(m),
            default: m === config.model
        })));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function numbersModal(tab: SettingTab, config: BotConfig, isDM: boolean): ModalBuilder {
    const fields = settingsForTab(tab, isDM).filter((s): s is NumberSetting => s.kind === 'number').slice(0, 5);
    return new ModalBuilder()
        .setCustomId(`cfg:modal:${tab}`)
        .setTitle(`${TABS.find(t => t.id === tab)!.label} settings`)
        .addComponents(fields.map(s => new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId(s.key)
                .setLabel(`${s.label}${s.unit ? ` (${s.unit})` : ''}`.slice(0, 45))
                .setPlaceholder(rangeHint(s))
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(String(displayNumber(s, config[s.key])))
        )));
}

function rangeHint(s: NumberSetting): string {
    const low = s.minExclusive ? `> ${s.min}` : `${s.min}`;
    return s.max === undefined ? `${low} or more` : `${low} – ${s.max}`;
}

// ── Proposals from agents ───────────────────────────────────────────────

export function buildProposalMessage(proposal: SettingProposal, mode: string): Payload {
    const setting = getSetting(proposal.key)!;
    const persona = PERSONAS[mode]?.name ?? 'The bot';
    const encoded = setting.kind === 'toggle' ? (proposal.value ? 'on' : 'off') : String(proposal.value);
    const embed = new EmbedBuilder()
        .setColor(0xd69e2e)
        .setTitle(`💡 ${persona} suggests a setting change`)
        .setDescription(`${capitalize(describeChange(setting, proposal.value))}\n> ${proposal.reason.slice(0, 500)}`)
        .setFooter({ text: 'Anyone may apply it · takes effect from the next message' });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`cfg:prop:${setting.key}:${encoded}`).setLabel('Apply').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cfg:nope').setLabel('Not now').setEmoji('✖️').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}

// ── Interaction handling ────────────────────────────────────────────────

export function isSettingsInteraction(interaction: Interaction): interaction is ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction {
    return (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
        && interaction.customId.startsWith('cfg:');
}

export async function handleSettingsInteraction(
    interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
    state: BotState
): Promise<void> {
    const isDM = !interaction.guildId;
    const id = interaction.guildId ?? interaction.user.id;
    const config = state.getConfig(id, isDM);
    const [, action, arg, value] = interaction.customId.split(':');
    const who = interaction.user.displayName ?? interaction.user.username;

    const deny = async (reason: string) => {
        await interaction.reply({ content: `🔒 ${reason}`, ephemeral: true });
    };
    const rerender = async (tab: SettingTab, footer?: string) => {
        const payload = await buildSettingsPanel(state, id, isDM, tab, footer);
        if (interaction.isModalSubmit() && !interaction.isFromMessage()) {
            await interaction.reply(payload);
        } else {
            await (interaction as ButtonInteraction).update(payload);
        }
    };
    const currentFooter = () => interaction.message?.embeds[0]?.footer?.text;

    switch (action) {
        case 'tab':
            await rerender(arg as SettingTab, currentFooter());
            return;

        case 't': {
            const setting = getSetting(arg);
            if (!setting || setting.kind !== 'toggle') return;
            const denied = permissionError(interaction, config, setting);
            if (denied) return deny(denied);
            const next = !config[setting.key];
            applySetting(state, id, isDM, setting, next);
            console.log(`⚙️ ${who} set ${setting.key} → ${next} (${isDM ? 'DM' : 'guild'} ${id})`);
            await rerender(setting.tab, `Last change: ${who} turned ${setting.label} ${next ? 'on' : 'off'}`);
            return;
        }

        case 'mode':
        case 'model': {
            if (!interaction.isStringSelectMenu()) return;
            const denied = permissionError(interaction, config);
            if (denied) return deny(denied);
            const choice = interaction.values[0];
            if (action === 'mode') {
                applyMode(state, id, isDM, choice as BotMode);
            } else {
                state.updateConfig(id, isDM, { model: choice });
            }
            console.log(`⚙️ ${who} set ${action} → ${choice} (${isDM ? 'DM' : 'guild'} ${id})`);
            const label = action === 'mode' ? `persona to ${PERSONA_OPTIONS.find(p => p.mode === choice)?.label ?? choice}` : `model to ${choice}`;
            await rerender('chat', `Last change: ${who} set ${label}`);
            return;
        }

        case 'num': {
            if (!interaction.isButton()) return;
            const denied = permissionError(interaction, config);
            if (denied) return deny(denied);
            await interaction.showModal(numbersModal(arg as SettingTab, config, isDM));
            return;
        }

        case 'modal': {
            if (!interaction.isModalSubmit()) return;
            const denied = permissionError(interaction, config);
            if (denied) return deny(denied);
            const changed: string[] = [];
            const errors: string[] = [];
            for (const s of settingsForTab(arg as SettingTab, isDM)) {
                if (s.kind !== 'number') continue;
                let raw: string;
                try { raw = interaction.fields.getTextInputValue(s.key); } catch { continue; }
                const parsed = parseSettingValue(s, raw);
                if (!parsed.ok) { errors.push(parsed.error); continue; }
                if (parsed.value === config[s.key]) continue;
                applySetting(state, id, isDM, s, parsed.value);
                changed.push(`${s.label} ${formatSetting(s, state.getConfig(id, isDM))}`);
            }
            if (changed.length) console.log(`⚙️ ${who} set ${changed.join(', ')} (${isDM ? 'DM' : 'guild'} ${id})`);
            await rerender(arg as SettingTab, changed.length ? `Last change: ${who} set ${changed.join(', ')}`.slice(0, 2048) : currentFooter());
            if (errors.length) {
                await interaction.followUp({ content: `⚠️ Not changed:\n${errors.map(e => `• ${e}`).join('\n')}`, ephemeral: true });
            }
            return;
        }

        case 'prop': {
            if (!interaction.isButton()) return;
            const setting = getSetting(arg);
            if (!setting?.proposable) return;
            const denied = permissionError(interaction, config, setting);
            if (denied) return deny(denied);
            const parsed = parseSettingValue(setting, value);
            if (!parsed.ok) return deny(parsed.error);
            applySetting(state, id, isDM, setting, parsed.value);
            console.log(`⚙️ ${who} applied proposal ${setting.key} → ${value} (${isDM ? 'DM' : 'guild'} ${id})`);
            await resolveProposal(interaction, 0x38a169, `✅ Applied by ${who}`);
            return;
        }

        case 'nope':
            if (!interaction.isButton()) return;
            await resolveProposal(interaction, 0x718096, `✖️ Dismissed by ${who}`);
            return;
    }
}

async function resolveProposal(interaction: ButtonInteraction, color: number, outcome: string): Promise<void> {
    const original = interaction.message.embeds[0];
    const embed = original ? EmbedBuilder.from(original) : new EmbedBuilder();
    embed.setColor(color).setFooter({ text: outcome });
    await interaction.update({ embeds: [embed], components: [] });
}

/**
 * Who may change settings: anyone, unless admin mode is on (then admins, or
 * everyone if `settings` is whitelisted). Settings marked requiresAdmin always
 * need a server administrator. DMs are unrestricted, like commands.
 */
export function permissionError(
    interaction: { inGuild(): boolean; memberPermissions: { has(p: bigint): boolean } | null },
    config: BotConfig,
    setting?: Setting
): string | null {
    if (!interaction.inGuild()) return null;
    const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    if (admin) return null;
    if (setting?.requiresAdmin) return 'Only server administrators can change this.';
    if (!config.adminMode) return null;
    if (config.commandWhitelist.some(c => c.toLowerCase() === 'settings')) return null;
    return 'Admin mode is on — only administrators can change settings.';
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
