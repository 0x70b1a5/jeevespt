import { Message } from 'discord.js';
import { Command, CommandContext, CommandDependencies, GeneratedResponse } from './types';
import { commandUtils } from './utils';
import { getWebpage } from '../getWebpage';

/**
 * Muse handler - generates commentary on webpages
 */
export class MuseHandler {
    constructor(
        private generateResponse: (
            id: string,
            isDM: boolean,
            additionalMessages?: { role: string; content: string }[]
        ) => Promise<GeneratedResponse | null>,
        private deps: CommandDependencies
    ) {}

    async muse(
        message: Message,
        id: string,
        isDM: boolean,
        url?: string,
        museWasRequested = false
    ): Promise<void> {
        console.log(`🎯 Initiating muse for ${isDM ? 'user' : 'guild'}: ${id}${url ? ` with URL: ${url}` : ''}`);
        await message.channel.sendTyping();

        let pageText = '';
        try {
            if (url) {
                pageText = await getWebpage(url);
            } else {
                const wikipage = await this.getRandomWikipediaPage();
                pageText = wikipage.extract;
                url = wikipage.content_urls?.desktop?.page;
            }
        } catch (error) {
            console.error('Error fetching webpage:', error);
            await commandUtils.reply(message, `Error fetching webpage (${url || 'random'}): ${error}`);
            return;
        }

        const config = this.deps.state.getConfig(id, isDM);
        const prompt = {
            role: 'system',
            content: `
${museWasRequested ? '' : "It's been a while since the last message. It's up to you to inject some activity into the situation! "}

Please read the following webpage.

=== BEGIN WEBPAGE ===
${pageText}
=== END WEBPAGE ===

Please consider the implications of this webpage, which may be relevant to recent discussions. Read it carefully, and bring some insight to the discussion. Try to extract something new. Don't just summarize it! We want to engage in a way that is interesting to the audience. Be creative, think step by step, and wow the audience with your ability to synthesize pithy witticisms from many domains of knowledge.

Respond in at most 280 characters - this is a chatroom, not a blog post.

And remember, you are in ${config.mode} mode. Please conform to the instructions, it's very important! :)

If there was an error fetching the webpage, please mention this, as the developer will want to fix his code.`
        };

        const response = await this.generateResponse(id, isDM, [prompt]);
        if (response) {
            const chunks = commandUtils.splitMessageIntoChunks([response]);
            for (const chunk of chunks) {
                if (chunk) {
                    await commandUtils.sendWebhookMessage(message.channel, chunk, config.mode);
                }
            }
            if (url) {
                await commandUtils.sendWebhookMessage(message.channel, url, config.mode);
            }
        }
    }

    private async getRandomWikipediaPage(): Promise<any> {
        const response = await fetch('https://en.wikipedia.org/api/rest_v1/page/random/summary');
        return response.json();
    }
}

/**
 * !muse - Trigger muse on a webpage
 */
export const museCommand: Command = {
    names: ['muse'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        // This will be wired up in the main handler
        // The actual muse logic requires generateResponse which is defined there
        throw new Error('Muse command must be handled by CommandHandler directly');
    }
};

/**
 * !museon - Enable automatic muse
 */
export const museOnCommand: Command = {
    names: ['museon'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { shouldMuseRegularly: true });
        await commandUtils.reply(ctx.message, 'Muse will now happen automatically.');
    }
};

/**
 * !museoff - Disable automatic muse
 */
export const museOffCommand: Command = {
    names: ['museoff'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        deps.state.updateConfig(ctx.id, ctx.isDM, { shouldMuseRegularly: false });
        await commandUtils.reply(ctx.message, 'Muse will no longer happen automatically.');
    }
};

/**
 * !museinterval - Set muse interval
 */
export const museIntervalCommand: Command = {
    names: ['museinterval'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const hours = Number(ctx.args[0]);

        if (!isNaN(hours) && hours > 0) {
            deps.state.updateConfig(ctx.id, ctx.isDM, { museInterval: hours * 60 * 60 * 1000 });
            await commandUtils.reply(ctx.message, `Muse interval set to ${hours} hours.`);
        } else {
            await commandUtils.reply(
                ctx.message,
                'Failed to parse muse interval. Please provide a positive number of hours.'
            );
        }
    }
};

// Export muse commands (excluding museCommand which needs special handling)
export const museCommands: Command[] = [
    museOnCommand,
    museOffCommand,
    museIntervalCommand
];
