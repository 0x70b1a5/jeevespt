# JeevesPT — Agent Guide

Discord bot with multi-persona chat (Jeeves, toki pona, Lugso, custom), ambient participation (joins conversations unprompted, decided by TypeSafe's Jev model), people notes & follow-ups, reminders/tasks, learning, autotranslate, reactions, muse, voice. TypeScript + discord.js v14 + Jest.

## Commands

| Task | Command |
|------|---------|
| Run bot | `npm start` or `npm run dev` |
| Unit tests | `npm test` |
| Typecheck | `npx tsc --noEmit` |
| Install | `npm install` |

Env keys (see `.env.sample`): `DISCORD_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `OPENAI_API_KEY` (Whisper), `ELEVENLABS_API_KEY`, `IUNCTUS_URL` + `IUNCTUS_API_KEY` (`!shorten`), `TYPESAFE_API_KEY` (Jev: ambient gate + reaction emoji), optional `DISCORD_GUILD_ID`.

## Architecture (where to look)

```
src/
  server.ts          # Discord client, timers, wires clients → CommandHandler
  commands/
    index.ts         # CommandHandler: message flow, generateResponse, runTask
    registry.ts      # Command registry (shared by !prefix and /slash)
    types.ts         # Command / CommandDependencies / CommandContext
    config.ts        # !model, temperature, websearch, think*, etc.
    modes.ts         # !prompt (persona switching lives in /settings)
    settings.ts      # /settings panel command
    listPanel.ts     # Managed lists with ❌ remove buttons (reminders, tasks, translate, learning, reactchannels, whitelist, notes)
    notes.ts         # /notes: what the bot remembers about you
    retired.ts       # Old command names → "has moved to …" redirects
    tasks.ts         # Scheduled task NL parser (hardcoded Claude haiku)
    …                # reminders, learning, reactions, translate, muse, …
  llm/generate.ts    # Multi-provider LLM: Claude + Grok + Poolside routing, agent loop
  llm/tools.ts       # Client-side agent tools (AGENT_TOOLS), e.g. fetch_webpage; people tools
  llm/typesafe.ts    # TypeSafe System One client (Jev): typed noul/choice/score judgments
  chat/history.ts    # Live per-channel chat history (replaces the old buffer/log)
  chat/ambient.ts    # Ambient policy: credit budget, engagement feedback, decide()
  chat/gate.ts       # Jev questions for the ambient gate + reaction emoji picker
  settings/schema.ts # Settings table (toggles + numbers + choices): parse/validate/apply, agent briefing
  settings/panel.ts  # /settings panel + agent proposal messages; cfg:* button/menu/modal handler
  state/             # BotState + stores; types + model lists in types.ts
  prompts/           # JEEVES_PROMPT, JEEVES_GROK_ADDENDUM, TOKIPONA, WEB_SEARCH_ADDENDUM, lugso
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
| `poolside/*` | Poolside | OpenAI SDK `chat.completions.create` (no web search) |
| else (Claude) | Anthropic | `messages.create` (SDK retries transient errors, `maxRetries: 3`) |

Helpers in `src/state/types.ts` (import from `src/state`):

- `isXaiModel(model)` — `model.startsWith('grok-')`; `isPoolsideModel(model)` — `model.startsWith('poolside/')`
- `VALID_XAI_MODELS` / `VALID_POOLSIDE_MODELS` / `VALID_ANTHROPIC_MODELS` / `isValidModel`

**Wiring:** `CommandDependencies` has `openai`, **`xai`**, `anthropic`, `elevenLabs`, `state`, optional `poolside`. Constructor order on `CommandHandler`:

```ts
new CommandHandler(state, openai, xai, anthropic, elevenLabs, poolside)
```

**When adding LLM call sites:** use `generateText({ anthropic, xai, poolside }, opts)` — do not call Anthropic/xAI SDKs directly (exceptions: hardcoded utility paths like task NL parser / sitelen / patreon edit that intentionally pin Claude).

**Feature mapping:**

- Web search: Anthropic `web_search_20250305`; xAI `{ type: 'web_search' }`
- Extended thinking: Anthropic `thinking` — `{type: 'adaptive'}` on Opus/Sonnet 4.6+ and Fable (`modelUsesAdaptiveThinking`; `budget_tokens` is a 400 there), `budget_tokens: 3000` on older/Haiku; xAI only bumps `max_output_tokens` (Grok reasons natively)
- Built-in thinking: Opus/Sonnet 5+, Fable and Mythos think even with no `thinking` param (`modelThinksByDefault`), so they always get the +3000 `max_tokens` headroom — otherwise small caps (ambient 400) are eaten by reasoning and replies stop mid-sentence. Any provider hitting its output cap logs `⚠️ … hit the N-token output cap`.
- Effort: `thinkingEffort` setting → Anthropic `output_config.effort` via `effortForModel` (adaptive models only; `auto` = high with extended thinking, else model default; `xhigh`→`high` on 4.6)
- Temperature: Anthropic gated by `modelSupportsTemperature` in `commands/constants.ts`; xAI always may send temperature
- Citations: `withSourcesFooter()` formats Sources block

**Agent loop:** pass `tools: LlmTool[]` to `generateText` and each provider keeps calling the model — running requested tools sequentially, feeding results back in its native format (Anthropic `tool_use`/`tool_result`, xAI `function_call`/`function_call_output`, Poolside chat `tool_calls`/`role: 'tool'`) — until the model stops on its own. `maxSteps` (default `DEFAULT_MAX_STEPS` = 20) is a runaway guard; on the last step tools are disabled (`tool_choice: none`) to force an answer. Anthropic `pause_turn` (server web-search limit) is resumed automatically. Only the final turn's text is returned (tool-call narration is dropped); sources/search counts accumulate. Tool errors are returned to the model, not thrown. Chat (`generateResponse`) and tasks (`runTask`) pass `AGENT_TOOLS`; utility call sites (translate, reactions, learning) don't. To add a tool: define an `LlmTool` in `llm/tools.ts` and add it to `AGENT_TOOLS`.

**`!model`:** lists both providers (live fetch + static fallback). Example: `!model grok-4.5`.

Default chat model remains Claude Sonnet (`BotState` defaultConfig).

## Conventions

- Prefer TypeScript; match existing style (no drive-by refactors).
- Commands: register via `registry.registerAll` in `CommandHandler`; set `description`, `category`, `options` for help + slash.
- New config flags: add to `BotConfig` in `state/types.ts`, default in `BotState`. If it's a simple on/off, number, or pick-one choice, add **one entry to `SETTINGS` in `settings/schema.ts`** — that gives it a panel button / Numbers-form field / dropdown and (with `proposable`) lets agents suggest it. Don't add per-setting commands.
- New list-shaped config (things you add and remove): `registerListKind` in `commands/listPanel.ts` + one command that lists (no args) or adds (with args). Removal is the ❌ buttons — don't add remove/list/cancel commands.
- Renaming or removing a command: add the old name to `commands/retired.ts` so it redirects.
- Tests: Jest; mock selenium / fs / external clients. When changing `CommandHandler` deps, update `commands.test.ts` mocks.
- LLM unit tests live in `src/llm/generate.test.ts`.
- Do not commit secrets; `.env` is local only.

## Chat history

There is no bot-side buffer or log. When replying, `generateResponse(..., { channel })` reads the channel's last `messageLimit` messages via `channelHistory.fetch` (`chat/history.ts`): per channel, oldest first, our own lines (bot user or our persona webhooks) as `assistant`, commands / `[SYSTEM]` notices / slash replies skipped. What Discord can't return — voice transcripts, attached-file text — is annotated per message id when the message arrives (`handleMessage`). "Clearing memory" (`!clear`, persona switch, `!prompt`) sets `config.contextResetAt`; history before it is ignored. Replies are debounced per channel (`responseDelayMs`).

## Ambient participation ("one of the fellas")

Channel frequencies: `all` / `mentions` / `none` / **`ambient`** (`/config`). With **Join any channel** (`ambientEverywhere`, admin) unconfigured channels are ambient too. In an ambient channel, @mentions and replies to the bot are answered directly; otherwise, once the channel settles, `runAmbientGate` (commands/index.ts):

1. Reads the last ~20 lines; never speaks twice running.
2. Asks **Jev** (`chat/gate.ts`, one TypeSafe request, ~100–300 ms): addressed? how much could he add (Score)? intrusive? responds to him? reaction-worthy? which message to answer (Choice)? which emoji (Choice over `BASE_EMOJI` + the server's custom emoji; recent ones down-weighted in code)?
3. `decide()` (`chat/ambient.ts`) applies policy in code: addressed → reply; else reply if `value × (1 − intrusive)` clears a bar that drops with **Sociability** (0–1 setting) *and* the channel has ≥1 credit; else react if worthy (¼ credit). Credit per human message = `sociability × engagement ÷ active speakers` (1 = a fair share of the conversation). Engagement rises when unprompted messages get replies/reactions/responses and falls when ignored.
4. Unprompted replies get a "[Joining in]" addendum (match the chat's median message length) and a token cap; webhooks can't do Discord replies, so answering an older message prefixes `-# ↪ [name](link)`.

**Ambient shadow mode** (`ambientShadow`) makes and logs every decision (`🎲 Ambient …`, `👻 Would say …`) but posts nothing — use it to tune. Keep Jev's arithmetic-free: thresholds and budgets live in `chat/ambient.ts`. Reaction mode (`/reactchannels`) also picks its emoji with Jev (`chooseReaction`); without `TYPESAFE_API_KEY` both stay quiet.

**People.** Live chat replies get `remember_about_person` (notes in `data/people.json`, injected into the system prompt when that person is in the conversation; each person sees/removes theirs via `/notes`) and `schedule_followup` (a reminder with `followup` set, listed in that person's `/reminders`; when due, `sendFollowup` asks them about it in character).

## Settings panel & agent proposals

- `/settings` (or `!settings`) posts a **public** panel: tabs (Chat / Features / Admin), checkbox-style toggle buttons (green ✅ on, grey ⬜ off), persona + model dropdowns, and a "Numbers…" modal. Everything a component needs is in its `custom_id` (`cfg:…`), so panels survive restarts with no bookkeeping (the Joblin pattern). `server.ts` hands every button/menu/modal to `CommandHandler.handleComponent`, which routes `cfg:*` to the settings panel and `lst:*` to managed lists.
- Permissions: anyone, unless admin mode is on (then admins, or everyone if `settings` is whitelisted); `requiresAdmin` settings (admin mode) always need an administrator.
- Agents get a one-line settings briefing in the system prompt (`describeSettingsForAgent`). In live chat replies (`generateResponse(..., { allowProposals: true })` from `sendDelayedResponse`) they also get `propose_setting_change`: it only **queues** a proposal (one per reply, `proposable` settings only); the bot posts it after the reply with Apply / Not now buttons, and anyone may apply it. Agents never change settings themselves.

## Command surface

22 slash commands (from 59) after folding settings into `/settings` and list/remove pairs into single list commands (plus `/notes`). `scripts/validate-slash.ts` checks the payloads against Discord's limits.

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
