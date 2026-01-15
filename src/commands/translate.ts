import { Message } from 'discord.js';
import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils, CommandUtilsImpl } from './utils';
import { extractTranslatableEmbedContent } from '../formatMessage';

/**
 * !translateadd - Add a channel to autotranslate
 */
export const translateAddCommand: Command = {
    names: ['translateadd'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        if (ctx.args.length < 2) {
            await commandUtils.reply(
                ctx.message,
                `Usage: \`!translateadd <#channel> <language>\`\n` +
                `Example: \`!translateadd #toki-pona "toki pona"\` - translates messages from #toki-pona to toki pona`
            );
            return;
        }

        const channelName = ctx.args[0];
        const language = ctx.args.slice(1).join(' ');

        const channelId = commandUtils.getChannelIdFromName(ctx.message, channelName);
        if (!channelId) {
            await commandUtils.reply(ctx.message, `Could not find channel "${channelName}".`);
            return;
        }

        deps.state.addAutotranslateChannel(ctx.id, ctx.isDM, channelId, language);

        const channel = ctx.message.guild!.channels.cache.get(channelId);
        const channelMention = channel ? `<#${channelId}>` : channelName;

        await commandUtils.reply(
            ctx.message,
            `Added ${channelMention} to autotranslate.\n` +
            `Messages in that channel will be automatically translated to **${language}**.`
        );
    }
};

/**
 * !translateremove - Remove a channel from autotranslate
 */
export const translateRemoveCommand: Command = {
    names: ['translateremove'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const channelName = ctx.args[0];

        if (!channelName) {
            await commandUtils.reply(ctx.message, 'Please specify a channel name.');
            return;
        }

        const channelId = commandUtils.getChannelIdFromName(ctx.message, channelName);
        if (!channelId) {
            await commandUtils.reply(ctx.message, `Could not find channel "${channelName}".`);
            return;
        }

        const wasRemoved = deps.state.removeAutotranslateChannel(ctx.id, ctx.isDM, channelId);

        if (wasRemoved) {
            const channel = ctx.message.guild!.channels.cache.get(channelId);
            const channelMention = channel ? `<#${channelId}>` : channelName;
            await commandUtils.reply(ctx.message, `Removed ${channelMention} from autotranslate.`);
        } else {
            await commandUtils.reply(ctx.message, `Channel "${channelName}" is not in the autotranslate list.`);
        }
    }
};

/**
 * !translatelist - List autotranslate channels
 */
export const translateListCommand: Command = {
    names: ['translatelist'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const channels = deps.state.getAllAutotranslateChannels(ctx.id, ctx.isDM);

        if (channels.length === 0) {
            await commandUtils.reply(
                ctx.message,
                `No channels are currently configured for autotranslate.\n` +
                `Use \`!translateadd <#channel> <language>\` to add a channel.`
            );
            return;
        }

        let channelList = '🌐 **Autotranslate Channels:**\n\n';
        for (const { channelId, language } of channels) {
            const channel = ctx.message.guild!.channels.cache.get(channelId);
            const channelName = channel ? `<#${channelId}>` : `Unknown (${channelId})`;
            channelList += `• ${channelName} → **${language}**\n`;
        }

        await ctx.message.reply(channelList);
    }
};

/**
 * !translateadduser - Add a user to autotranslate
 */
export const translateAddUserCommand: Command = {
    names: ['translateadduser'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        if (ctx.args.length < 2) {
            await commandUtils.reply(
                ctx.message,
                `Usage: \`!translateadduser <@user or userId> <language>\`\n` +
                `Example: \`!translateadduser @Alice Quenya\` - translates messages for Alice to Quenya\n` +
                `Example: \`!translateadduser 123456789 Latin\` - translates messages for user ID to Latin`
            );
            return;
        }

        const userId = parseUserId(ctx.args[0]);
        if (!userId) {
            await commandUtils.reply(ctx.message, 'Invalid user format. Use @mention or user ID.');
            return;
        }

        const language = ctx.args.slice(1).join(' ');
        deps.state.addAutotranslateUser(ctx.id, ctx.isDM, userId, language);

        await commandUtils.reply(
            ctx.message,
            `Added <@${userId}> to autotranslate.\n` +
            `Messages from that user will be automatically translated to **${language}**.`
        );
    }
};

/**
 * !translateremoveuser - Remove a user from autotranslate
 */
export const translateRemoveUserCommand: Command = {
    names: ['translateremoveuser'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        if (ctx.args.length < 1) {
            await commandUtils.reply(
                ctx.message,
                `Usage: \`!translateremoveuser <@user> [language]\`\n` +
                `Remove a specific language or all languages for a user.\n` +
                `Examples:\n` +
                `- \`!translateremoveuser @Alice Latin\` - removes only Latin\n` +
                `- \`!translateremoveuser @Alice\` - removes all languages for Alice`
            );
            return;
        }

        const userId = parseUserId(ctx.args[0]);
        if (!userId) {
            await commandUtils.reply(ctx.message, 'Invalid user format. Use @mention or user ID.');
            return;
        }

        const language = ctx.args.length > 1 ? ctx.args.slice(1).join(' ') : undefined;
        const wasRemoved = deps.state.removeAutotranslateUser(ctx.id, ctx.isDM, userId, language);

        if (wasRemoved) {
            if (language) {
                await commandUtils.reply(ctx.message, `Removed **${language}** for <@${userId}> from autotranslate.`);
            } else {
                await commandUtils.reply(ctx.message, `Removed all languages for <@${userId}> from autotranslate.`);
            }
        } else {
            if (language) {
                await commandUtils.reply(ctx.message, `User <@${userId}> does not have **${language}** configured.`);
            } else {
                await commandUtils.reply(ctx.message, `User <@${userId}> is not in the autotranslate list.`);
            }
        }
    }
};

/**
 * !translatelistusers - List users configured for autotranslate
 */
export const translateListUsersCommand: Command = {
    names: ['translatelistusers'],
    requiresGuild: true,
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const users = deps.state.getAllAutotranslateUsers(ctx.id, ctx.isDM);

        if (users.length === 0) {
            await commandUtils.reply(
                ctx.message,
                `No users are currently configured for autotranslate.\n` +
                `Use \`!translateadduser <@user> <language>\` to add a user.`
            );
            return;
        }

        // Group languages by user
        const userLanguageMap = new Map<string, string[]>();
        for (const { userId, language } of users) {
            if (!userLanguageMap.has(userId)) {
                userLanguageMap.set(userId, []);
            }
            userLanguageMap.get(userId)!.push(language);
        }

        let userList = '🌐 **Autotranslate Users:**\n\n';
        for (const [userId, languages] of userLanguageMap) {
            userList += `• <@${userId}> → **${languages.join(', ')}**\n`;
        }

        await ctx.message.reply(userList);
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

        const response = await deps.anthropic.messages.create({
            model: config.model,
            max_tokens: 10,
            temperature: 0.1,
            messages: [{
                role: 'user',
                content: `Is the following text written in ${targetLanguage}? Respond with only "yes" or "no":\n\n${text}`
            }],
            system: `You are a language detection expert. Determine if text is written in the specified language.`
        });

        const detectionResult = response.content[0]?.type === 'text'
            ? response.content[0].text.trim().toLowerCase()
            : '';

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

        const response = await deps.anthropic.messages.create({
            model: config.model,
            max_tokens: 1000,
            temperature: 0.3,
            messages: [{
                role: 'user',
                content: `Translate the following text to ${targetLanguage}. Only respond with the translation, nothing else:\n\n${text}`
            }],
            system: `You are a professional translator. Translate text accurately and naturally to ${targetLanguage}.`
        });

        return response.content[0]?.type === 'text' ? response.content[0].text : null;
    } catch (error) {
        console.error('Error generating translation:', error);
        return null;
    }
}

// Export all translate commands
export const translateCommands: Command[] = [
    translateAddCommand,
    translateRemoveCommand,
    translateListCommand,
    translateAddUserCommand,
    translateRemoveUserCommand,
    translateListUsersCommand
];
