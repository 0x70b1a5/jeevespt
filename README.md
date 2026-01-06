# JeevesPT - A general-purpose AI Discord bot

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)
![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)
![Claude](https://img.shields.io/badge/Claude-Anthropic-d4a27f?logo=anthropic)
![License](https://img.shields.io/badge/license-ISC-green)
![Satisfaction](https://img.shields.io/badge/satisfaction-given,%20sir-success)

A sophisticated Discord bot powered by Claude (Anthropic) with multiple personas, voice capabilities, spaced-repetition learning, auto-translation, and more.

## Features

### Multi-Persona System
- **Jeeves** — A cultured butler modeled on P.G. Wodehouse's iconic character, dispensing advice with impeccable Queen's English and references to philosophy, literature, and Catholic theology
- **jan pona** — A toki pona-only speaker for language immersion
- **Jargonatus** — A specialized persona with custom behavior
- **Custom Prompts** — Define your own system prompt for fully customizable personalities

### Voice Integration
- **Speech-to-Text** — Transcribe audio messages using OpenAI Whisper
- **Voice Commands** — Execute bot commands via voice (say "command clear" to run `!clear`)
- **Text-to-Speech** — Optional voice responses via ElevenLabs (Jonathan Cecil voice for authentic Jeeves delivery)

### Learning System
- **Spaced Repetition** — Bot periodically quizzes you on configurable subjects (Latin, toki pona, music theory, etc.)
- **Smart Scheduling** — Questions distributed throughout the day based on number of subjects
- **Progress Tracking** — Persistent tracking of question history per subject

### Auto-Translation
- **Per-Channel Translation** — Automatically translate all messages in specified channels to a target language
- **Per-User Translation** — Configure translations for specific users (supports multiple target languages per user)
- **Skip Token** — Start messages with "notr" to bypass translation

### Musing Mode
- **Wikipedia Contemplation** — Bot periodically fetches random Wikipedia articles and shares thoughts
- **URL Analysis** — Point the bot at any webpage for commentary
- **Selenium-Powered** — Full JavaScript rendering for modern web pages

### Reaction Mode
- AI-driven contextual emoji reactions on messages in monitored channels

### Reminders
- Natural time parsing (`5m`, `2h`, `1d`)
- Persistent across bot restarts
- Personalized delivery messages matching the bot's current persona

### Channel & Response Control
- **Per-Channel Configuration** — Set response frequency per channel: respond to all messages, mentions only, or ignore entirely
- **DM Support** — Full functionality in direct messages with separate configuration
- **Message Batching** — Configurable delay to wait for multiple messages before responding

### Technical
- **Multi-Model Support** — Switch between Claude models on the fly with validation
- **Conversation Persistence** — Message history and configuration saved to disk
- **Webhook Personas** — Each mode uses distinct bot name and avatar
- **Graceful Shutdown** — State persistence and farewell messages on SIGINT

## Setup

1. Setup a Discord bot and get the token
    - https://discord.com/developers/applications
    - Create an application
    - Create a bot
    - Copy the token
    - add token to .env file
2. Install dependencies
    - `npm install`
1. Run the bot
    - `ts-node bot.ts | tee -a log.txt`
1. Approve the bot in the server
