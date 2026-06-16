require('dotenv').config()
import fs from "fs";
import { execSync } from "child_process";
import OpenAI from "openai";

export interface TranscriptionResult {
  text: string;
  speedScalarUsed: number;
  wasRetry: boolean;
  error?: string;
}

const MAX_HALVING_DEPTH = 8; // up to 256 segments

function speedUpAudio(inputPath: string, outputPath: string, speedScalar: number): void {
  let atempoFilters: string[] = [];
  let remaining = speedScalar;

  while (remaining > 2.0) {
    atempoFilters.push('atempo=2.0');
    remaining /= 2.0;
  }
  if (remaining > 0.5) {
    atempoFilters.push(`atempo=${remaining}`);
  }

  const filterChain = atempoFilters.join(',');
  const command = `ffmpeg -y -i "${inputPath}" -filter:a "${filterChain}" "${outputPath}"`;
  execSync(command, { stdio: 'pipe' });
}

function getAudioDuration(filePath: string): number {
  const output = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
    { encoding: 'utf-8' }
  );
  return parseFloat(output.trim());
}

function extractSegment(inputPath: string, startTime: number, duration: number, outputPath: string): void {
  // NOTE: do not use `-c copy` here. Discord voice messages are Ogg/Opus
  // (even though we save them as .mp3), and Opus packets cannot be stream-copied
  // into an .mp3 container. Re-encode so the segment is always a valid file.
  execSync(
    `ffmpeg -y -ss ${startTime} -i "${inputPath}" -t ${duration} "${outputPath}"`,
    { stdio: 'pipe' }
  );
}

function cleanupFile(filePath: string): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function transcribeWithHalving(
  openai: OpenAI,
  originalPath: string,
  startTime: number,
  endTime: number,
  depth: number
): Promise<string> {
  const ext = originalPath.match(/(\.[^.]+)$/)?.[1] || '.mp3';
  const base = originalPath.replace(/(\.[^.]+)$/, '');
  const tag = `_seg${startTime.toFixed(1)}_${endTime.toFixed(1)}`;
  const segPath = `${base}${tag}${ext}`;
  const speedPath = `${base}${tag}_2x${ext}`;

  try {
    extractSegment(originalPath, startTime, endTime - startTime, segPath);
    speedUpAudio(segPath, speedPath, 2.0);
    cleanupFile(segPath);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(speedPath),
      model: "whisper-1",
    });

    cleanupFile(speedPath);
    return transcription.text;
  } catch (error: any) {
    cleanupFile(segPath);
    cleanupFile(speedPath);

    if (depth >= MAX_HALVING_DEPTH) {
      throw error;
    }

    const mid = (startTime + endTime) / 2;
    console.log(`⚠️ Segment ${startTime.toFixed(1)}s-${endTime.toFixed(1)}s failed, halving (depth ${depth + 1})...`);

    const leftText = await transcribeWithHalving(openai, originalPath, startTime, mid, depth + 1);
    const rightText = await transcribeWithHalving(openai, originalPath, mid, endTime, depth + 1);
    return leftText + ' ' + rightText;
  }
}

export default async function whisper(
  openai: OpenAI,
  path: string,
  speedScalar: number = 1.0
): Promise<TranscriptionResult> {
  let audioPath = path;
  let usedScalar = speedScalar;

  // Speed up if requested
  if (speedScalar !== 1.0) {
    const speedUpPath = path.replace(/(\.[^.]+)$/, `_speed${speedScalar}$1`);
    try {
      speedUpAudio(path, speedUpPath, speedScalar);
      audioPath = speedUpPath;
    } catch (ffmpegError: any) {
      console.error(`⚠️ ffmpeg speed adjustment failed: ${ffmpegError.message}`);
      audioPath = path;
      usedScalar = 1.0;
    }
  }

  // First attempt
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
    });
    if (audioPath !== path) cleanupFile(audioPath);
    return { text: transcription.text, speedScalarUsed: usedScalar, wasRetry: false };
  } catch {
    if (audioPath !== path) cleanupFile(audioPath);
  }

  // Retry at 2x (skip if already 2x+)
  if (speedScalar < 2.0) {
    const retryPath = path.replace(/(\.[^.]+)$/, `_speed2$1`);
    console.log(`⚠️ Transcription failed, retrying with 2.0x speed...`);
    try {
      speedUpAudio(path, retryPath, 2.0);
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(retryPath),
        model: "whisper-1",
      });
      cleanupFile(retryPath);
      return { text: transcription.text, speedScalarUsed: 2.0, wasRetry: true };
    } catch {
      cleanupFile(retryPath);
    }
  }

  // Binary halving: split audio in half, recurse on each piece
  console.log(`⚠️ Retries exhausted, entering binary halving mode...`);
  try {
    const duration = getAudioDuration(path);
    const text = await transcribeWithHalving(openai, path, 0, duration, 0);
    return { text, speedScalarUsed: 2.0, wasRetry: true };
  } catch (error: any) {
    const rawMessage = error?.error?.message || error?.message || 'Unknown transcription error';
    // ffmpeg dumps its full stderr into the message; keep it short so callers
    // (e.g. Discord, max 2000 chars) can always relay it without erroring.
    const errorMessage = rawMessage.length > 300 ? `${rawMessage.slice(0, 300)}…` : rawMessage;
    return {
      text: '',
      speedScalarUsed: 2.0,
      wasRetry: true,
      error: `Transcription failed after halving: ${errorMessage}`
    };
  }
}
