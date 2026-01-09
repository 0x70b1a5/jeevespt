#!/usr/bin/env node
//
// standalone script for oneoffs
//

require('dotenv').config();
const fs = require('fs');
const { execSync } = require('child_process');
const { OpenAI } = require('openai');

/**
 * Speeds up an audio file using ffmpeg's atempo filter.
 * @param {string} inputPath Path to the input audio file
 * @param {string} outputPath Path where the sped-up audio will be saved
 * @param {number} speedScalar Speed multiplier (e.g., 2.0 = 2x speed)
 */
function speedUpAudio(inputPath, outputPath, speedScalar) {
    // atempo filter supports values between 0.5 and 100.0
    // For values > 2.0, we need to chain multiple atempo filters
    const atempoFilters = [];
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

async function transcribe(filePath, speedScalar = 1.0) {
    if (!filePath) {
        console.error('Usage: node transcribe.js <audio-file-path> [speed-scalar]');
        console.error('  speed-scalar: Optional, 0.5-4.0 (default: 1.0). Speeds up audio before transcription.');
        process.exit(1);
    }

    if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
    }

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });

    let audioPath = filePath;
    let usedScalar = speedScalar;

    // If speed scalar is not 1.0, process the audio with ffmpeg first
    if (speedScalar !== 1.0) {
        const speedUpPath = filePath.replace(/(\.[^.]+)$/, `_speed${speedScalar}$1`);
        try {
            console.log(`Speeding up audio by ${speedScalar}x...`);
            speedUpAudio(filePath, speedUpPath, speedScalar);
            audioPath = speedUpPath;
        } catch (ffmpegError) {
            console.error(`Warning: ffmpeg speed adjustment failed: ${ffmpegError.message}`);
            console.error('Falling back to original audio.');
            audioPath = filePath;
            usedScalar = 1.0;
        }
    }

    try {
        console.log(`Transcribing: ${audioPath}${usedScalar !== 1.0 ? ` (at ${usedScalar}x speed)` : ''}`);

        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: "whisper-1",
        });

        // Clean up temporary sped-up file if created
        if (audioPath !== filePath && fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
        }

        console.log('\n--- Transcript ---');
        console.log(transcription.text);

    } catch (error) {
        // Clean up temporary file on error too
        if (audioPath !== filePath && fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
        }

        // If already at 2.0+ speed, don't retry
        if (speedScalar >= 2.0) {
            console.error('Error during transcription:', error.message);
            process.exit(1);
        }

        // Retry with 2.0 speed scalar
        console.log(`Transcription failed, retrying with 2.0x speed...`);
        const retryScalar = 2.0;
        const retryPath = filePath.replace(/(\.[^.]+)$/, `_speed${retryScalar}$1`);

        try {
            speedUpAudio(filePath, retryPath, retryScalar);

            const retryTranscription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(retryPath),
                model: "whisper-1",
            });

            // Clean up retry file
            if (fs.existsSync(retryPath)) {
                fs.unlinkSync(retryPath);
            }

            console.log('\n--- Transcript (succeeded on retry at 2x speed) ---');
            console.log(retryTranscription.text);

        } catch (retryError) {
            // Clean up retry file on error
            if (fs.existsSync(retryPath)) {
                fs.unlinkSync(retryPath);
            }

            console.error('Error during transcription (after retry):', retryError.message);
            process.exit(1);
        }
    }
}

// Get file path and optional speed scalar from command line arguments
const filePath = process.argv[2];
const speedScalar = process.argv[3] ? parseFloat(process.argv[3]) : 1.0;

if (speedScalar < 0.5 || speedScalar > 4.0) {
    console.error('Error: Speed scalar must be between 0.5 and 4.0');
    process.exit(1);
}

transcribe(filePath, speedScalar);
