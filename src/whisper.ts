require('dotenv').config()
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileP = promisify(execFile);

export interface TranscriptionResult {
  text: string;
  speedScalarUsed: number;
  wasRetry: boolean;
  error?: string;
}

// Local whisper.cpp — no OpenAI upload, no 25MB limit, so no 2x-retry or
// binary-halving fallbacks needed.
const WHISPER_BIN = process.env.WHISPER_CPP_BIN || '/root/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_CPP_MODEL || '/root/whisper.cpp/models/ggml-base.en.bin';
const WHISPER_THREADS = process.env.WHISPER_CPP_THREADS || '2';
const TRANSCRIBE_TIMEOUT_MS = 60 * 60 * 1000;

// One transcription at a time: the box has 2 cores and ~1.5GB free RAM, so
// concurrent whisper processes would thrash instead of overlapping usefully.
let queue: Promise<unknown> = Promise.resolve();

function buildAtempoChain(speedScalar: number): string {
  const filters: string[] = [];
  let remaining = speedScalar;
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  if (remaining > 0.5) {
    filters.push(`atempo=${remaining}`);
  }
  return filters.join(',');
}

// whisper.cpp wants 16kHz mono 16-bit WAV; apply any speedup in the same pass.
async function convertToWav(inputPath: string, outputPath: string, speedScalar: number): Promise<void> {
  const args = ['-y', '-i', inputPath];
  if (speedScalar !== 1.0) {
    args.push('-filter:a', buildAtempoChain(speedScalar));
  }
  args.push('-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outputPath);
  await execFileP('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024 });
}

function cleanupFile(filePath: string): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function runWhisperCpp(wavPath: string): Promise<string> {
  // nice -n 19 so transcription only takes CPU the servers on this box don't want.
  const { stdout } = await execFileP('nice', [
    '-n', '19',
    WHISPER_BIN,
    '-m', WHISPER_MODEL,
    '-f', wavPath,
    '-t', WHISPER_THREADS,
    '--no-timestamps',
    '--no-prints',
  ], { timeout: TRANSCRIBE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 });
  return stdout.replace(/\s+/g, ' ').trim();
}

export default async function whisper(
  path: string,
  speedScalar: number = 1.0
): Promise<TranscriptionResult> {
  const run = queue.then(async (): Promise<TranscriptionResult> => {
    const wavPath = path.replace(/(\.[^.]+)?$/, `_16k.wav`);
    let usedScalar = speedScalar;

    try {
      try {
        await convertToWav(path, wavPath, speedScalar);
      } catch (ffmpegError: any) {
        if (speedScalar === 1.0) throw ffmpegError;
        // Speedup filter failed — fall back to plain conversion.
        console.error(`⚠️ ffmpeg speed adjustment failed: ${ffmpegError.message}`);
        usedScalar = 1.0;
        await convertToWav(path, wavPath, 1.0);
      }

      const text = await runWhisperCpp(wavPath);
      return { text, speedScalarUsed: usedScalar, wasRetry: false };
    } catch (error: any) {
      const rawMessage = error?.message || 'Unknown transcription error';
      // ffmpeg/whisper dump full stderr into the message; keep it short so
      // callers (e.g. Discord, max 2000 chars) can always relay it.
      const errorMessage = rawMessage.length > 300 ? `${rawMessage.slice(0, 300)}…` : rawMessage;
      return {
        text: '',
        speedScalarUsed: usedScalar,
        wasRetry: false,
        error: `Transcription failed: ${errorMessage}`
      };
    } finally {
      cleanupFile(wavPath);
    }
  });

  queue = run.catch(() => {});
  return run;
}
