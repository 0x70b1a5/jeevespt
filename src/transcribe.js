#!/usr/bin/env node
//
// standalone script for oneoffs
//

require('dotenv').config();
const fs = require('fs');
const { execSync } = require('child_process');
const { OpenAI } = require('openai');

const MAX_HALVING_DEPTH = 8;

function speedUpAudio(inputPath, outputPath, speedScalar) {
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

function getAudioDuration(filePath) {
    const output = execSync(
        `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
        { encoding: 'utf-8' }
    );
    return parseFloat(output.trim());
}

function extractSegment(inputPath, startTime, duration, outputPath) {
    execSync(
        // No `-c copy`: Opus packets can't be stream-copied into an .mp3
        // container. Re-encode so the segment is always a valid file.
        `ffmpeg -y -ss ${startTime} -i "${inputPath}" -t ${duration} "${outputPath}"`,
        { stdio: 'pipe' }
    );
}

function cleanupFile(filePath) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function transcribeWithHalving(openai, originalPath, startTime, endTime, depth) {
    const ext = (originalPath.match(/(\.[^.]+)$/) || [, '.mp3'])[1];
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
    } catch (error) {
        cleanupFile(segPath);
        cleanupFile(speedPath);

        if (depth >= MAX_HALVING_DEPTH) {
            throw error;
        }

        const mid = (startTime + endTime) / 2;
        console.error(`Segment ${startTime.toFixed(1)}s-${endTime.toFixed(1)}s failed, halving (depth ${depth + 1})...`);

        const leftText = await transcribeWithHalving(openai, originalPath, startTime, mid, depth + 1);
        const rightText = await transcribeWithHalving(openai, originalPath, mid, endTime, depth + 1);
        return leftText + ' ' + rightText;
    }
}

function printTranscript(text, label) {
    if (rawMode) {
        process.stdout.write(text);
    } else {
        console.log(`\n--- ${label} ---`);
        console.log(text);
    }
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
        apiKey: process.env.OPENAI_API_KEY,
        timeout: 30000,
    });

    let audioPath = filePath;
    let usedScalar = speedScalar;

    // Speed up if requested
    if (speedScalar !== 1.0) {
        const speedUpPath = filePath.replace(/(\.[^.]+)$/, `_speed${speedScalar}$1`);
        try {
            console.error(`Speeding up audio by ${speedScalar}x...`);
            speedUpAudio(filePath, speedUpPath, speedScalar);
            audioPath = speedUpPath;
        } catch (ffmpegError) {
            console.error(`Warning: ffmpeg speed adjustment failed: ${ffmpegError.message}`);
            console.error('Falling back to original audio.');
            audioPath = filePath;
            usedScalar = 1.0;
        }
    }

    // First attempt
    try {
        console.error(`Transcribing: ${audioPath}${usedScalar !== 1.0 ? ` (at ${usedScalar}x speed)` : ''}`);
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: "whisper-1",
        });
        if (audioPath !== filePath) cleanupFile(audioPath);
        printTranscript(transcription.text, 'Transcript');
        return;
    } catch {
        if (audioPath !== filePath) cleanupFile(audioPath);
    }

    // Retry at 2x (skip if already 2x+)
    if (speedScalar < 2.0) {
        const retryPath = filePath.replace(/(\.[^.]+)$/, `_speed2$1`);
        console.error(`Transcription failed, retrying with 2.0x speed...`);
        try {
            speedUpAudio(filePath, retryPath, 2.0);
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(retryPath),
                model: "whisper-1",
            });
            cleanupFile(retryPath);
            printTranscript(transcription.text, 'Transcript (succeeded on retry at 2x speed)');
            return;
        } catch {
            cleanupFile(retryPath);
        }
    }

    // Binary halving
    console.error(`Retries exhausted, entering binary halving mode...`);
    try {
        const duration = getAudioDuration(filePath);
        const text = await transcribeWithHalving(openai, filePath, 0, duration, 0);
        printTranscript(text, 'Transcript (via binary halving)');
    } catch (error) {
        console.error('Error during transcription (after halving):', error.message);
        process.exit(1);
    }
}

// Get file path and optional speed scalar from command line arguments
const args = process.argv.slice(2).filter(a => a !== '--raw');
const rawMode = process.argv.includes('--raw');
const filePath = args[0];
const speedScalar = args[1] ? parseFloat(args[1]) : 1.0;

if (speedScalar < 0.5 || speedScalar > 4.0) {
    console.error('Error: Speed scalar must be between 0.5 and 4.0');
    process.exit(1);
}

transcribe(filePath, speedScalar);
