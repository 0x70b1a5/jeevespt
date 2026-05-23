import { toFile } from 'openai';
import { PNG } from 'pngjs';
import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils, isSendableChannel } from './utils';
import { renderSitelenPng } from '../assets/sitelen-wasm';

function padPngToSquare(input: Buffer): Buffer {
    const src = PNG.sync.read(input);
    const { width, height, data } = src;
    if (width === height) return input;
    const size = Math.max(width, height);
    const offX = (size - width) >> 1;
    const offY = (size - height) >> 1;
    const dst = new PNG({ width: size, height: size });
    dst.data.fill(0xff);
    for (let y = 0; y < height; y++) {
        const srcStart = y * width * 4;
        const dstStart = ((y + offY) * size + offX) * 4;
        data.copy(dst.data, dstStart, srcStart, srcStart + width * 4);
    }
    return PNG.sync.write(dst);
}

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
            'You translate Toki Pona into English and write embellishment instructions for an image editor ' +
            'that will transform a black-and-white sitelen sitelen (Toki Pona hieroglyphic) image into a richly illustrated artifact. ' +
            'Given a Toki Pona sentence, respond with strict JSON containing two fields: ' +
            '`translation` (a literal English translation, one short sentence) and ' +
            '`prompt` (a one-to-two-sentence instruction telling the editor to keep the existing glyph shapes intact and recognizable, ' +
            'but to embellish them with colors, textures, and thematic decoration drawn from the translation\'s meaning — ' +
            'specify a concrete style/setting that frames the glyphs as an illuminated, decorated artifact). ' +
            'Example: input "mi o lawa e soweli mani" → translation: "I must govern the cows." → ' +
            'prompt: "Keep the hieroglyphs intact and recognizable, but embellish them as an illuminated Western frontier manuscript — sun-bleached leather and golden lasso filigree winding around the glyphs, dusty prairie palette." ' +
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
    sitelenPng: Buffer,
    prompt: string,
    deps: CommandDependencies
): Promise<Buffer | null> {
    const image = await toFile(sitelenPng, 'sitelen.png', { type: 'image/png' });
    const result = await deps.openai.images.edit({
        model: 'gpt-image-1',
        image,
        prompt,
        n: 1,
        size: '1024x1024',
        input_fidelity: 'high'
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

        await channel.sendTyping();
        const typingInterval = setInterval(() => {
            channel.sendTyping().catch(() => {});
        }, 8000);

        try {
            let sitelenPng: Buffer;
            try {
                sitelenPng = padPngToSquare(renderSitelenPng(text));
            } catch (error: any) {
                console.error('sitelen render error:', error);
                await commandUtils.replyError(ctx.message, `Renderer failed: ${error.message ?? error}`);
                return;
            }

            let plan: GlamPlan | null = null;
            try {
                plan = await planGlam(text, deps);
            } catch (error) {
                console.error('sitelen glam plan error:', error);
            }
            if (!plan) {
                await commandUtils.replyError(ctx.message, "Couldn't dream up a glam prompt.");
                return;
            }

            let glamPng: Buffer | null = null;
            try {
                glamPng = await generateGlam(sitelenPng, plan.prompt, deps);
            } catch (error: any) {
                console.error('sitelen glam generation error:', error);
                await commandUtils.replyError(ctx.message, `Glam image failed: ${error.message ?? error}`);
                return;
            }
            if (!glamPng) {
                await commandUtils.replyError(ctx.message, 'Image generator returned no data.');
                return;
            }

            await ctx.message.reply({
                files: [{ attachment: glamPng, name: 'glam.png' }]
            });
        } finally {
            clearInterval(typingInterval);
        }
    }
};

export const sitelenCommands: Command[] = [sitelenCommand];
