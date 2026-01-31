/**
 * Patreon command - Creates weekly Twitter digest and posts to Patreon
 *
 * This command is restricted to a specific Discord user.
 */

import dotenv from 'dotenv'
import { Command, CommandContext, CommandDependencies } from './types';
import { SYS_PREFIX } from './constants';
import { fetchTweets, formatDigest } from '../nitter';
import { postToPatreon } from '../patreon';
dotenv.config()

// Only this Discord username can use the !patreon command
const ALLOWED_USER = process.env.PATREON_COMMAND_USERNAME

/**
 * Format the digest title with date range
 */
function getDigestTitle(): string {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const startDate = weekAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endDate = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    return `Weekly Twitter Digest - ${startDate} to ${endDate}`;
}

/**
 * !patreon command
 * Fetches tweets from the last 7 days and posts them to Patreon
 */
const patreonCommand: Command = {
    names: ['patreon'],
    async execute(ctx: CommandContext, deps: CommandDependencies): Promise<void> {
        const { message } = ctx;

        if (!ALLOWED_USER) {
            await message.reply(`${SYS_PREFIX}You need to set the ALLOWED_USER.`);
            return;
        }

        // Check if user is allowed
        if (message.author.username !== ALLOWED_USER) {
            // Error out as if command doesn't exist
            await message.reply(`${SYS_PREFIX}Unrecognized command "patreon".`);
            return;
        }

        const twitterUsername = process.env.TWITTER_USERNAME;
        if (!twitterUsername) {
            await message.reply(`${SYS_PREFIX}TWITTER_USERNAME is not set in .env`);
            return;
        }

        // Start the process
        await message.reply(`${SYS_PREFIX}Starting Patreon digest creation for @${twitterUsername}...`);

        try {
            // Step 1: Fetch tweets
            await message.channel.sendTyping();
            console.log(`📡 Fetching tweets for @${twitterUsername}...`);

            const result = await fetchTweets(twitterUsername, 7);

            if (result.error) {
                await message.reply(`${SYS_PREFIX}Error fetching tweets: ${result.error}`);
                return;
            }

            if (result.tweets.length === 0) {
                await message.reply(`${SYS_PREFIX}No tweets found for @${twitterUsername} in the last 7 days.`);
                return;
            }

            await message.reply(`${SYS_PREFIX}Found ${result.tweets.length} tweets from the last 7 days.`);

            // Step 2: Format the digest
            const digestContent = formatDigest(result.tweets, twitterUsername);
            const digestTitle = getDigestTitle();

            console.log(`📝 Formatted digest: ${digestTitle}`);

            // Step 3: Post to Patreon
            await message.channel.sendTyping();
            await message.reply(`${SYS_PREFIX}Posting digest to Patreon ($5 tier)...`);

            const postResult = await postToPatreon(digestTitle, digestContent, 5);

            if (postResult.success) {
                let successMsg = `${SYS_PREFIX}Successfully posted digest to Patreon!`;
                if (postResult.postUrl) {
                    successMsg += `\n${postResult.postUrl}`;
                }
                await message.reply(successMsg);
            } else {
                await message.reply(`${SYS_PREFIX}Error posting to Patreon: ${postResult.error}`);
            }

        } catch (error) {
            console.error('❌ Error in patreon command:', error);
            await message.reply(`${SYS_PREFIX}An error occurred: ${error}`);
        }
    }
};

export const patreonCommands: Command[] = [patreonCommand];
