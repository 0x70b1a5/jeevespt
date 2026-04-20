import { Command, CommandContext, CommandDependencies } from './types';
import { commandUtils, isSendableChannel } from './utils';
import { SYS_PREFIX, TEMP_DIR } from './constants';
import whisper from '../whisper';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export const transcribeCommand: Command = {
    names: ['transcribe'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const url = ctx.args[0];
        if (!url) {
            await commandUtils.reply(ctx.message, 'Usage: `!transcribe <youtube-url>`');
            return;
        }

        const channel = ctx.message.channel;
        if (!isSendableChannel(channel)) return;

        const tag = `yt_${ctx.message.author.id}_${Date.now()}`;
        const outputTemplate = path.join(TEMP_DIR, `${tag}.%(ext)s`);
        const audioFile = path.join(TEMP_DIR, `${tag}.mp3`);

        await commandUtils.reply(ctx.message, 'Downloading audio from YouTube...');
        await channel.sendTyping();

        try {
            execFileSync('yt-dlp', [
                '-x', '--audio-format', 'mp3',
                '-o', outputTemplate,
                '--', url
            ], { stdio: 'pipe', timeout: 300000 });

            if (!fs.existsSync(audioFile)) {
                await commandUtils.replyError(ctx.message, 'Failed to download audio.');
                return;
            }

            await channel.send(`${SYS_PREFIX}Transcribing audio...`);
            await channel.sendTyping();

            const result = await whisper(deps.openai, audioFile);

            if (result.error) {
                await commandUtils.replyError(ctx.message, result.error);
                return;
            }

            if (!result.text?.length) {
                await commandUtils.replyError(ctx.message, 'Could not transcribe audio.');
                return;
            }

            const chunks = commandUtils.splitMessageIntoChunks([{ role: 'user', content: result.text }]);
            await channel.send(`${SYS_PREFIX}Transcription:`);
            for (const chunk of chunks) {
                if (chunk) await channel.send(chunk);
            }
        } catch (error: any) {
            console.error('Transcribe command error:', error);
            await commandUtils.replyError(ctx.message, `Transcription failed: ${error.message}`);
        } finally {
            if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
        }
    }
};

export const transcribeCommands: Command[] = [transcribeCommand];
