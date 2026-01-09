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

/**
 * Speeds up an audio file using ffmpeg's atempo filter.
 * @param inputPath Path to the input audio file
 * @param outputPath Path where the sped-up audio will be saved
 * @param speedScalar Speed multiplier (e.g., 2.0 = 2x speed)
 */
function speedUpAudio(inputPath: string, outputPath: string, speedScalar: number): void {
  // atempo filter supports values between 0.5 and 100.0
  // For values > 2.0, we need to chain multiple atempo filters
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

/**
 * Transcribes audio using OpenAI Whisper with optional speed scaling and retry logic.
 * @param openai OpenAI client instance
 * @param path Path to the audio file
 * @param speedScalar Speed multiplier for audio preprocessing (default: 1.0)
 * @returns TranscriptionResult with text and metadata about the transcription
 */
export default async function whisper(
  openai: OpenAI,
  path: string,
  speedScalar: number = 1.0
): Promise<TranscriptionResult> {
  let audioPath = path;
  let usedScalar = speedScalar;
  let wasRetry = false;

  // If speed scalar is not 1.0, process the audio with ffmpeg first
  if (speedScalar !== 1.0) {
    const speedUpPath = path.replace(/(\.[^.]+)$/, `_speed${speedScalar}$1`);
    try {
      speedUpAudio(path, speedUpPath, speedScalar);
      audioPath = speedUpPath;
    } catch (ffmpegError: any) {
      console.error(`⚠️ ffmpeg speed adjustment failed: ${ffmpegError.message}`);
      // Fall back to original audio
      audioPath = path;
      usedScalar = 1.0;
    }
  }

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
    });

    // Clean up temporary sped-up file if created
    if (audioPath !== path && fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }

    return {
      text: transcription.text,
      speedScalarUsed: usedScalar,
      wasRetry: false
    };
  } catch (error: any) {
    // Clean up temporary file on error too
    if (audioPath !== path && fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }

    // If this was already a retry or already at 2.0+ speed, bubble up the error
    if (wasRetry || speedScalar >= 2.0) {
      const errorMessage = error?.error?.message || error?.message || 'Unknown transcription error';
      return {
        text: '',
        speedScalarUsed: usedScalar,
        wasRetry: wasRetry,
        error: `Transcription failed: ${errorMessage}`
      };
    }

    // Retry with 2.0 speed scalar
    console.log(`⚠️ Transcription failed, retrying with 2.0x speed...`);
    const retryScalar = 2.0;
    const retryPath = path.replace(/(\.[^.]+)$/, `_speed${retryScalar}$1`);

    try {
      speedUpAudio(path, retryPath, retryScalar);

      const retryTranscription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(retryPath),
        model: "whisper-1",
      });

      // Clean up retry file
      if (fs.existsSync(retryPath)) {
        fs.unlinkSync(retryPath);
      }

      return {
        text: retryTranscription.text,
        speedScalarUsed: retryScalar,
        wasRetry: true
      };
    } catch (retryError: any) {
      // Clean up retry file on error
      if (fs.existsSync(retryPath)) {
        fs.unlinkSync(retryPath);
      }

      const errorMessage = retryError?.error?.message || retryError?.message || 'Unknown transcription error';
      return {
        text: '',
        speedScalarUsed: retryScalar,
        wasRetry: true,
        error: `Transcription failed after retry: ${errorMessage}`
      };
    }
  }
}
