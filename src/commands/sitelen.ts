import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils, isSendableChannel } from './utils';
import { SYS_PREFIX } from './constants';
import { renderSitelenPng } from '../assets/sitelen-wasm';

interface GlamPlan {
    translation: string;
    prompt: string;
}

async function planGlam(
    text: string,
    deps: CommandDependencies
): Promise<GlamPlan | null> {
    const response = await deps.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system:
            'You translate Toki Pona into English and write whimsical, evocative prompts for an image generator. ' +
            'Given a Toki Pona sentence, respond with strict JSON containing two fields: ' +
            '`translation` (a literal English translation, one short sentence) and ' +
            '`prompt` (a vivid one-to-two-sentence art prompt that riffs on the translation\'s meaning — ' +
            'lean into the most evocative interpretation, suggest a concrete style and setting). ' +
            'Example: input "mi o lawa e soweli mani" → translation: "I must govern the cows." → ' +
            'prompt: "A weathered cowboy at golden hour leading a herd across an open Texan prairie, painterly Western illustration with warm dusty light." ' +
            'Output JSON only, no preamble.',
        messages: [{ role: 'user', content: text }]
    });
    const block = response.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
    if (!block) return null;
    const match = block.text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        const parsed = JSON.parse(match[0]);
        if (typeof parsed.translation === 'string' && typeof parsed.prompt === 'string') {
            return { translation: parsed.translation, prompt: parsed.prompt };
        }
    } catch {
        return null;
    }
    return null;
}

async function generateGlam(
    prompt: string,
    deps: CommandDependencies
): Promise<Buffer | null> {
    const result = await deps.openai.images.generate({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1024'
    });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) return null;
    return Buffer.from(b64, 'base64');
}

export const sitelenCommand: Command = {
    names: ['sitelen'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const text = ctx.args.join(' ').trim();
        if (!text) {
            await commandUtils.reply(
                ctx.message,
                'Usage: `!sitelen <toki pona text>` — renders sitelen sitelen and a glammed-up companion image.'
            );
            return;
        }

        const channel = ctx.message.channel;
        if (!isSendableChannel(channel)) return;

        let sitelenPng: Buffer;
        try {
            sitelenPng = renderSitelenPng(text);
        } catch (error: any) {
            console.error('sitelen render error:', error);
            await commandUtils.replyError(ctx.message, `Renderer failed: ${error.message ?? error}`);
            return;
        }

        await ctx.message.reply({
            files: [{ attachment: sitelenPng, name: 'sitelen.png' }]
        });

        await channel.sendTyping();

        let plan: GlamPlan | null = null;
        try {
            plan = await planGlam(text, deps);
        } catch (error) {
            console.error('sitelen glam plan error:', error);
        }
        if (!plan) {
            await channel.send(`${SYS_PREFIX}Couldn't dream up a glam prompt; skipping.`);
            return;
        }

        await channel.send(
            `${SYS_PREFIX}*"${plan.translation}"* — glamming up...`
        );
        await channel.sendTyping();

        let glamPng: Buffer | null = null;
        try {
            glamPng = await generateGlam(plan.prompt, deps);
        } catch (error: any) {
            console.error('sitelen glam generation error:', error);
            await commandUtils.replyError(ctx.message, `Glam image failed: ${error.message ?? error}`);
            return;
        }
        if (!glamPng) {
            await commandUtils.replyError(ctx.message, 'Image generator returned no data.');
            return;
        }

        await channel.send({
            content: `> ${plan.prompt}`,
            files: [{ attachment: glamPng, name: 'glam.png' }]
        });
    }
};

export const sitelenCommands: Command[] = [sitelenCommand];
