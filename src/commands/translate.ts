import { Message } from 'discord.js';
import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils, CommandUtilsImpl } from './utils';
import { buildListMessage, registerListKind } from './listPanel';
import { generateText } from '../llm/generate';
import { extractTranslatableEmbedContent } from '../formatMessage';

/** Everything being auto-translated here: channels, then users (one row per language). */
export const translateList = registerListKind({
    code: 'tr',
    command: 'translate',
    title: '🌐 Autotranslate',
    empty: 'Nothing is being translated. Add a channel with `/translate channel:#channel language:Spanish`, or a person with `/translate user:@name language:Latin`.',
    entries: (deps, scope) => [
        ...deps.state.getAllAutotranslateChannels(scope.id, scope.isDM).map(c => ({
            value: `c:${c.channelId}`,
            text: `<#${c.channelId}> → **${c.language}**`
        })),
        ...deps.state.getAllAutotranslateUsers(scope.id, scope.isDM).map(u => ({
            value: `u:${u.userId}:${u.language}`,
            text: `<@${u.userId}> → **${u.language}**`
        }))
    ],
    remove: (deps, scope, entry) => {
        const [type, target, ...language] = entry.value.split(':');
        if (type === 'c') {
            deps.state.removeAutotranslateChannel(scope.id, scope.isDM, target);
        } else {
            deps.state.removeAutotranslateUser(scope.id, scope.isDM, target, language.join(':'));
        }
    }
});

/**
 * !translate — show what's being auto-translated (❌ to remove), or add a
 * channel or a person:
 *   !translate                      → list
 *   !translate #channel Spanish     → translate everything in #channel
 *   !translate @Alice Quenya        → translate Alice's messages (repeatable per language)
 */
export const translateCommand: Command = {
    names: ['translate'],
    requiresGuild: true,
    description: 'Auto-translate a channel or a person: no arguments lists them (with remove buttons).',
    category: 'Autotranslate',
    options: [
        { name: 'channel', description: 'Channel whose messages to translate', type: 'channel', required: false },
        { name: 'user', description: 'Person whose messages to translate', type: 'user', required: false },
        { name: 'language', description: 'Target language (e.g. Spanish, toki pona)', type: 'string', required: false, rest: true }
    ],
    examples: ['!translate', '!translate #spanish-practice Spanish', '!translate @Alice Quenya'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const scope = { id: ctx.id, isDM: ctx.isDM, ownerId: ctx.message.author.id };
        if (ctx.args.length === 0) {
            await ctx.message.reply(buildListMessage(translateList, deps, scope));
            return;
        }

        const [target, ...rest] = ctx.args;
        const language = rest.join(' ').trim();
        if (parseUserId(rest[0] ?? '')) {
            await commandUtils.reply(ctx.message, 'One at a time, please: give either a channel or a person.');
            return;
        }
        if (!language) {
            await commandUtils.reply(ctx.message, 'Say which language, e.g. `/translate channel:#chat language:Spanish` or `!translate @Alice Quenya`.');
            return;
        }

        const userId = parseUserId(target);
        let note: string;
        if (userId) {
            deps.state.addAutotranslateUser(ctx.id, ctx.isDM, userId, language);
            note = `✅ Added <@${userId}> → **${language}**`;
        } else {
            const channelId = commandUtils.getChannelIdFromName(ctx.message, target);
            if (!channelId) {
                await commandUtils.reply(ctx.message, `Could not find a channel or person called "${target}".`);
                return;
            }
            deps.state.addAutotranslateChannel(ctx.id, ctx.isDM, channelId, language);
            note = `✅ Added <#${channelId}> → **${language}**`;
        }
        await ctx.message.reply(buildListMessage(translateList, deps, scope, note));
    }
};

/**
 * Parse user ID from mention or direct ID
 */
function parseUserId(input: string): string | null {
    const mentionMatch = input.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
        return mentionMatch[1];
    }
    if (/^\d+$/.test(input)) {
        return input;
    }
    return null;
}

/**
 * Handle autotranslate for a message
 */
export async function handleAutotranslate(message: Message, deps: CommandDependencies): Promise<void> {
    if (!message.guild) return;
    if (message.author.bot) return;

    const id = message.guild.id;

    // Skip empty messages or commands
    if (!message.content || message.content.trim().length === 0 || message.content.startsWith('!')) {
        return;
    }

    // Skip messages that start with ". " (no translation)
    if (message.content.trim().startsWith('. ')) {
        return;
    }

    // Wait for embeds if message contains URLs
    const utils = new CommandUtilsImpl();
    if (utils.hasURLs(message.content)) {
        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    try {
        const messageContent = message.cleanContent;
        const embedData = extractTranslatableEmbedContent(message);

        const translations: { language: string; text: string }[] = [];
        const translatedLanguages = new Set<string>();

        // Channel-wide translation
        const channelLanguage = deps.state.getAutotranslateLanguage(id, false, message.channel.id);
        if (channelLanguage) {
            const translation = await performTranslation(
                messageContent,
                embedData,
                channelLanguage,
                id,
                deps
            );
            if (translation) {
                translations.push({ language: channelLanguage, text: translation });
                translatedLanguages.add(channelLanguage.toLowerCase());
            }
        }

        // User-specific translation
        const userLanguages = deps.state.getAutotranslateUserLanguages(id, false, message.author.id);
        for (const userLanguage of userLanguages) {
            if (!translatedLanguages.has(userLanguage.toLowerCase())) {
                const translation = await performTranslation(
                    messageContent,
                    embedData,
                    userLanguage,
                    id,
                    deps
                );
                if (translation) {
                    translations.push({ language: userLanguage, text: translation });
                    translatedLanguages.add(userLanguage.toLowerCase());
                }
            } else {
                console.log(`🌐 Skipping user translation to ${userLanguage} - already translated`);
            }
        }

        // Send all translations in a single message
        if (translations.length > 0) {
            const formattedTranslations = translations
                .map(({ language, text }) => `**${language}:** ${text}`)
                .join('\n\n');

            await message.reply(formattedTranslations);
            console.log(`🌐 Auto-translated message to ${translations.length} language(s): ${translations.map(t => t.language).join(', ')}`);
        }
    } catch (error) {
        console.error('Error auto-translating message:', error);
    }
}

/**
 * Perform translation of content to target language
 */
async function performTranslation(
    messageContent: string,
    embedData: string,
    targetLanguage: string,
    guildId: string,
    deps: CommandDependencies
): Promise<string | null> {
    try {
        const fullText = (messageContent + ' ' + embedData).trim();

        // Check for meaningful text
        const textWithoutUrls = fullText.replace(/https?:\/\/\S+/gi, '').replace(/\[.*?\]\(.*?\)/g, '').trim();
        const textWithoutUsernames = textWithoutUrls.replace(/@\w+/g, '').trim();

        if (textWithoutUsernames.length === 0) {
            console.log(`🌐 Skipping translation - no meaningful content`);
            return null;
        }

        // Check if already in target language
        const isAlreadyInTargetLanguage = await detectLanguage(messageContent, targetLanguage, guildId, deps);
        if (isAlreadyInTargetLanguage) {
            console.log(`🌐 Message already in ${targetLanguage}, skipping translation`);
            return null;
        }

        let translation = await generateTranslation(messageContent, targetLanguage, guildId, deps);
        if (!translation) return null;

        // Translate embeds if present
        if (embedData && embedData.trim().length > 0) {
            const embedTranslation = await generateTranslation(embedData.trim(), targetLanguage, guildId, deps);
            if (embedTranslation) {
                translation += `\n${embedTranslation}`;
            }
        }

        console.log(`🌐 Generated translation to ${targetLanguage}`);
        return translation;
    } catch (error) {
        console.error(`Error translating to ${targetLanguage}:`, error);
        return null;
    }
}

/**
 * Detect if text is in the target language
 */
async function detectLanguage(
    text: string,
    targetLanguage: string,
    guildId: string,
    deps: CommandDependencies
): Promise<boolean> {
    try {
        const config = deps.state.getConfig(guildId, false);

        const result = await generateText(
            { anthropic: deps.anthropic, xai: deps.xai, poolside: deps.poolside },
            {
                model: config.model,
                maxTokens: 10,
                temperature: 0.1,
                messages: [{
                    role: 'user',
                    content: `Is the following text written in ${targetLanguage}? Respond with only "yes" or "no":\n\n${text}`
                }],
                system: `You are a language detection expert. Determine if text is written in the specified language.`
            }
        );

        const detectionResult = (result.content || '').trim().toLowerCase();
        return detectionResult === 'yes';
    } catch (error) {
        console.error('Error detecting language:', error);
        return false;
    }
}

/**
 * Generate translation using AI
 */
async function generateTranslation(
    text: string,
    targetLanguage: string,
    guildId: string,
    deps: CommandDependencies
): Promise<string | null> {
    try {
        const config = deps.state.getConfig(guildId, false);

        const result = await generateText(
            { anthropic: deps.anthropic, xai: deps.xai, poolside: deps.poolside },
            {
                model: config.model,
                maxTokens: 1000,
                temperature: 0.3,
                messages: [{
                    role: 'user',
                    content: `Translate the following text to ${targetLanguage}. Only respond with the translation, nothing else:\n\n${text}`
                }],
                system: `You are a professional translator. Translate text accurately and naturally to ${targetLanguage}.`
            }
        );

        return result.content;
    } catch (error) {
        console.error('Error generating translation:', error);
        return null;
    }
}

// Export all translate commands
export const translateCommands: Command[] = [translateCommand];
