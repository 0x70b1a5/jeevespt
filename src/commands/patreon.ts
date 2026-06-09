/**
 * Patreon commands - Creates weekly Twitter digest and posts to Patreon
 *
 * Commands:
 *   !patreon - Fetches tweets and saves to patreon-post.txt
 *   !pedit [instructions] - Edits the post via LLM
 *   !ppost - Posts the content to Patreon
 *
 * These commands are restricted to a specific Discord user.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Command, CommandContext, CommandDependencies } from './types';
import { SYS_PREFIX } from './constants';
import { fetchTweets, formatDigest } from '../nitter';
import { postToPatreon } from '../patreon';
dotenv.config();

// Only this Discord username can use the patreon commands
const ALLOWED_USER = process.env.PATREON_COMMAND_USERNAME;

// File path for the patreon post draft
const PATREON_POST_FILE = path.join(process.cwd(), 'patreon-post.txt');

/**
 * Check if the user is allowed to run patreon commands
 */
function isAllowedUser(username: string): { allowed: boolean; error?: string } {
    if (!ALLOWED_USER) {
        return { allowed: false, error: 'PATREON_COMMAND_USERNAME is not set in .env' };
    }
    if (username !== ALLOWED_USER) {
        return { allowed: false };
    }
    return { allowed: true };
}

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
 * Split content into Discord-safe chunks
 */
function chunkContent(content: string, maxSize: number = 1900): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    for (const line of content.split('\n')) {
        if (currentChunk.length + line.length + 1 > maxSize) {
            chunks.push(currentChunk);
            currentChunk = line;
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    }
    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
}

/**
 * !patreon command
 * Fetches tweets from the last 7 days and saves them to patreon-post.txt
 */
const patreonCommand: Command = {
    names: ['patreon'],
    description: 'Build the weekly Twitter digest draft (operator only).',
    category: 'Patreon',
    slashExclude: true,
    hidden: true,
    async execute(ctx: CommandContext, deps: CommandDependencies): Promise<void> {
        const { message } = ctx;

        const check = isAllowedUser(message.author.username);
        if (!check.allowed) {
            if (check.error) {
                await message.reply(`${SYS_PREFIX}${check.error}`);
            } else {
                await message.reply(`${SYS_PREFIX}Unrecognized command "patreon".`);
            }
            return;
        }

        const twitterUsername = process.env.TWITTER_USERNAME;
        if (!twitterUsername) {
            await message.reply(`${SYS_PREFIX}TWITTER_USERNAME is not set in .env`);
            return;
        }

        await message.reply(`${SYS_PREFIX}Starting Patreon digest creation for @${twitterUsername}...`);

        try {
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

            // Format the digest
            const digestContent = formatDigest(result.tweets, twitterUsername);
            const digestTitle = getDigestTitle();

            console.log(`📝 Formatted digest: ${digestTitle}`);

            // Save to file (title on first line, blank line, then content)
            const fileContent = `${digestTitle}\n\n${digestContent}`;
            fs.writeFileSync(PATREON_POST_FILE, fileContent, 'utf8');

            await message.reply(`${SYS_PREFIX}Saved digest to \`patreon-post.txt\``);

            // Show preview
            await message.reply(`${SYS_PREFIX}**Preview:**`);
            await message.reply(`**${digestTitle}**`);

            const chunks = chunkContent(digestContent);
            for (const chunk of chunks) {
                await message.reply(chunk);
            }

            await message.reply(
                `${SYS_PREFIX}**Next steps:**\n` +
                `• \`!pedit [instructions]\` - Edit the draft (e.g., \`!pedit Remove the tweet about bats\`)\n` +
                `• \`!ppost\` - Post the draft to Patreon ($5+ tier)\n` +
                `• \`!patreon\` - Regenerate the digest from scratch`
            );

        } catch (error) {
            console.error('❌ Error in patreon command:', error);
            await message.reply(`${SYS_PREFIX}An error occurred: ${error}`);
        }
    }
};

/**
 * !pedit command
 * Reads patreon-post.txt, applies LLM edits based on instructions, saves result
 */
const peditCommand: Command = {
    names: ['pedit'],
    description: 'Edit the Patreon draft via LLM (operator only).',
    category: 'Patreon',
    slashExclude: true,
    hidden: true,
    async execute(ctx: CommandContext, deps: CommandDependencies): Promise<void> {
        const { message, args } = ctx;

        const check = isAllowedUser(message.author.username);
        if (!check.allowed) {
            if (check.error) {
                await message.reply(`${SYS_PREFIX}${check.error}`);
            } else {
                await message.reply(`${SYS_PREFIX}Unrecognized command "pedit".`);
            }
            return;
        }

        const instructions = args.join(' ').trim();
        if (!instructions) {
            await message.reply(`${SYS_PREFIX}Usage: \`!pedit [instructions]\`\nExample: \`!pedit Remove the tweet about bats\``);
            return;
        }

        // Check if file exists
        if (!fs.existsSync(PATREON_POST_FILE)) {
            await message.reply(`${SYS_PREFIX}No draft found. Run \`!patreon\` first to create a digest.`);
            return;
        }

        await message.reply(`${SYS_PREFIX}Editing draft...`);

        try {
            // Read current content
            const currentContent = fs.readFileSync(PATREON_POST_FILE, 'utf8');

            // Call LLM to edit
            const response = await deps.anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4000,
                messages: [
                    {
                        role: 'user',
                        content: `You are editing a Patreon post draft. Apply the requested changes and return ONLY the edited content with no additional commentary or explanation.

Current draft:
---
${currentContent}
---

Instructions: ${instructions}

Return the edited draft:`
                    }
                ]
            });

            // Extract text from response
            const textBlock = response.content.find(block => block.type === 'text');
            if (!textBlock || textBlock.type !== 'text') {
                await message.reply(`${SYS_PREFIX}Error: No response from LLM`);
                return;
            }

            const editedContent = textBlock.text.trim();

            // Save edited content
            fs.writeFileSync(PATREON_POST_FILE, editedContent, 'utf8');

            await message.reply(`${SYS_PREFIX}Draft updated. New preview:`);

            // Show preview
            const chunks = chunkContent(editedContent);
            for (const chunk of chunks) {
                await message.reply(chunk);
            }

            await message.reply(`${SYS_PREFIX}Use \`!pedit [instructions]\` to make more edits, or \`!ppost\` to post to Patreon.`);

        } catch (error) {
            console.error('❌ Error in pedit command:', error);
            await message.reply(`${SYS_PREFIX}An error occurred: ${error}`);
        }
    }
};

/**
 * !ppost command
 * Reads patreon-post.txt and posts it to Patreon
 */
const ppostCommand: Command = {
    names: ['ppost'],
    description: 'Post the Patreon draft to Patreon (operator only).',
    category: 'Patreon',
    slashExclude: true,
    hidden: true,
    async execute(ctx: CommandContext, deps: CommandDependencies): Promise<void> {
        const { message } = ctx;

        const check = isAllowedUser(message.author.username);
        if (!check.allowed) {
            if (check.error) {
                await message.reply(`${SYS_PREFIX}${check.error}`);
            } else {
                await message.reply(`${SYS_PREFIX}Unrecognized command "ppost".`);
            }
            return;
        }

        // Check if file exists
        if (!fs.existsSync(PATREON_POST_FILE)) {
            await message.reply(`${SYS_PREFIX}No draft found. Run \`!patreon\` first to create a digest.`);
            return;
        }

        try {
            // Read content
            const fileContent = fs.readFileSync(PATREON_POST_FILE, 'utf8');

            // Parse title (first line) and content (rest)
            const lines = fileContent.split('\n');
            const title = lines[0].trim();
            const content = lines.slice(2).join('\n').trim(); // Skip title and blank line

            if (!title || !content) {
                await message.reply(`${SYS_PREFIX}Draft file appears to be malformed. Run \`!patreon\` again.`);
                return;
            }

            await message.reply(`${SYS_PREFIX}Posting to Patreon...\n**Title:** ${title}\n**Content length:** ${content.length} characters`);

            // Post to Patreon
            const result = await postToPatreon(title, content, 5);

            if (result.success) {
                await message.reply(`${SYS_PREFIX}Successfully posted to Patreon!\n${result.postUrl || '(URL not available)'}`);

                // Optionally delete the draft file after successful post
                // fs.unlinkSync(PATREON_POST_FILE);
            } else {
                // Attach screenshot if available
                if (result.screenshotPath && fs.existsSync(result.screenshotPath)) {
                    await message.reply({
                        content: `${SYS_PREFIX}Failed to post to Patreon: ${result.error}`,
                        files: [result.screenshotPath]
                    });
                } else {
                    await message.reply(`${SYS_PREFIX}Failed to post to Patreon: ${result.error}`);
                }
            }

        } catch (error) {
            console.error('❌ Error in ppost command:', error);
            await message.reply(`${SYS_PREFIX}An error occurred: ${error}`);
        }
    }
};

export const patreonCommands: Command[] = [patreonCommand, peditCommand, ppostCommand];
