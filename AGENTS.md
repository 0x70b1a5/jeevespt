# JeevesPT — Agent Guide

Discord bot with multi-persona chat (Jeeves, toki pona, Lugso, custom), reminders/tasks, learning, autotranslate, reactions, muse, voice. TypeScript + discord.js v14 + Jest.

## Commands

| Task | Command |
|------|---------|
| Run bot | `npm start` or `npm run dev` |
| Unit tests | `npm test` |
| Typecheck | `npx tsc --noEmit` |
| Install | `npm install` |

Env keys (see `.env.sample`): `DISCORD_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `OPENAI_API_KEY` (Whisper), `ELEVENLABS_API_KEY`, `IUNCTUS_URL` + `IUNCTUS_API_KEY` (`!shorten`), optional `DISCORD_GUILD_ID`.

## Architecture (where to look)

```
src/
  server.ts          # Discord client, timers, wires clients → CommandHandler
  commands/
    index.ts         # CommandHandler: message flow, generateResponse, runTask
    registry.ts      # Command registry (shared by !prefix and /slash)
    types.ts         # Command / CommandDependencies / CommandContext
    config.ts        # !model, temperature, websearch, think*, etc.
    modes.ts         # !jeeves !tokipona !lugso !whisper !prompt
    tasks.ts         # Scheduled task NL parser (hardcoded Claude haiku)
    …                # reminders, learning, reactions, translate, muse, …
  llm/generate.ts    # Multi-provider LLM: Claude + Grok routing
  state/             # BotState + stores; types + model lists in types.ts
  prompts/           # JEEVES_PROMPT, JEEVES_GROK_ADDENDUM, TOKIPONA, WEB_SEARCH_ADDENDUM, lugso
  bot.ts             # Re-exports state (compat)
```

- **Entry:** `src/server.ts` constructs OpenAI (Whisper), **xAI** (`baseURL: https://api.x.ai/v1`), Anthropic, ElevenLabs → `CommandHandler`.
- **Commands:** metadata on each `Command` drives both `!help` and Discord slash registration (`commands/slash.ts`). Do not hand-write parallel slash defs.
- **Personas:** mode switches update `config.mode`; webhooks use `PERSONAS` in `commands/constants.ts`.
- **State:** per-guild / per-DM config, logs, buffers; persistence via BotState when `shouldSaveData`.

## Multi-provider LLM (critical)

All chat-like generation goes through **`generateText` in `src/llm/generate.ts`**.

| Model id | Provider | API |
|----------|----------|-----|
| `grok-*` | xAI | OpenAI SDK `responses.create` (`store: false`) |
| else (Claude) | Anthropic | `messages.create` |

Helpers in `src/state/types.ts` (re-exported via `bot.ts`):

- `isXaiModel(model)` — `model.startsWith('grok-')`
- `VALID_XAI_MODELS` / `VALID_ANTHROPIC_MODELS` / `isValidModel`

**Wiring:** `CommandDependencies` has `openai`, **`xai`**, `anthropic`, `elevenLabs`, `state`. Constructor order on `CommandHandler`:

```ts
new CommandHandler(state, openai, xai, anthropic, elevenLabs)
```

**When adding LLM call sites:** use `generateText({ anthropic, xai }, opts)` — do not call Anthropic/xAI SDKs directly (exceptions: hardcoded utility paths like task NL parser / sitelen / patreon edit that intentionally pin Claude).

**Feature mapping:**

- Web search: Anthropic `web_search_20250305`; xAI `{ type: 'web_search' }`
- Extended thinking: Anthropic `thinking` budget; xAI only bumps `max_output_tokens` (Grok reasons natively)
- Temperature: Anthropic gated by `modelSupportsTemperature` in `commands/constants.ts`; xAI always may send temperature
- Citations: `withSourcesFooter()` formats Sources block

**`!model`:** lists both providers (live fetch + static fallback). Example: `!model grok-4.5`.

Default chat model remains Claude Sonnet (`BotState` defaultConfig).

## Conventions

- Prefer TypeScript; match existing style (no drive-by refactors).
- Commands: register via `registry.registerAll` in `CommandHandler`; set `description`, `category`, `options` for help + slash.
- New config flags: add to `BotConfig` in `state/types.ts`, default in `BotState`, command(s) in `config.ts` or domain module.
- Tests: Jest; mock selenium / fs / external clients. When changing `CommandHandler` deps, update `commands.test.ts` mocks.
- LLM unit tests live in `src/llm/generate.test.ts`.
- Do not commit secrets; `.env` is local only.

## Personas / product notes

- **Jeeves** is the flagship persona (`prompts/prompts.ts`) — Wodehouse butler, King’s English, philosophy/theology allusions; keep voice intact when editing the prompt.
- **Grok in Jeeves mode** also gets `JEEVES_GROK_ADDENDUM`: Grok is the intellect (powerhouse), Jeeves is the household name and diction. Guests address him as Jeeves; do not overwrite Grok’s truth-seeking. Claude does not receive this addendum.
- Web-search addendum is only appended when search is actually enabled (or forced for tasks).
- Tasks force web search on regardless of channel chat setting.

## Smoke checks after LLM changes

1. `npm test`
2. `npx tsc --noEmit`
3. Optional live Grok: needs `XAI_API_KEY` **with credits** on the xAI console team. Without credits, API returns 403 permission-denied.

## Do not re-bootstrap blindly

This file is the bootstrap. For deeper detail, read the files linked above rather than re-scanning the whole tree. Update **this** file when architecture or multi-provider behavior changes.
