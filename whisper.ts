require('dotenv').config()
import fs from "fs";
import OpenAI from "openai";

export default async function whisper(openai: OpenAI, path: string) {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(path),
    model: "whisper-1",
  });

  return transcription
}