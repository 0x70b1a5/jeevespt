#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const { OpenAI } = require('openai');

async function transcribe(filePath) {
    if (!filePath) {
        console.error('Usage: node transcribe.js <audio-file-path>');
        process.exit(1);
    }

    if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
    }

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });

    try {
        console.log(`Transcribing: ${filePath}`);

        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-1",
        });

        console.log('\n--- Transcript ---');
        console.log(transcription.text);

    } catch (error) {
        console.error('Error during transcription:', error.message);
        process.exit(1);
    }
}

// Get file path from command line arguments
const filePath = process.argv[2];
transcribe(filePath); 