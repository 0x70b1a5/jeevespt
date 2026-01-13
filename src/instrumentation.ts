import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("jeevespt");

/**
 * Wrap an async operation in a span
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      span.setAttributes(attributes);
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Wrap Claude API call
 */
export async function tracedClaudeCompletion<T>(
  model: string,
  messageCount: number,
  completionFn: () => Promise<T>
): Promise<T> {
  return withSpan(
    "claude.completion",
    {
      "ai.model": model,
      "ai.message_count": messageCount,
    },
    completionFn
  );
}

/**
 * Wrap Whisper transcription
 */
export async function tracedWhisperTranscription<T>(
  speedScalar: number,
  transcribeFn: () => Promise<T>
): Promise<T> {
  return withSpan(
    "whisper.transcribe",
    {
      "whisper.speed_scalar": speedScalar,
    },
    transcribeFn
  );
}

/**
 * Wrap ElevenLabs TTS
 */
export async function tracedTTS<T>(
  textLength: number,
  ttsFn: () => Promise<T>
): Promise<T> {
  return withSpan(
    "elevenlabs.tts",
    {
      "tts.text_length": textLength,
    },
    ttsFn
  );
}

/**
 * Wrap Discord message handling
 */
export async function tracedMessageHandler<T>(
  channelId: string,
  guildId: string | null,
  hasAttachments: boolean,
  mode: string,
  handlerFn: () => Promise<T>
): Promise<T> {
  return withSpan(
    "discord.message.handle",
    {
      "discord.channel_id": channelId,
      "discord.guild_id": guildId || "dm",
      "discord.has_attachments": hasAttachments,
      "discord.persona": mode,
    },
    handlerFn
  );
}

/**
 * Wrap Wikipedia fetch for muse mode
 */
export async function tracedWikipediaFetch<T>(
  fetchFn: () => Promise<T>
): Promise<T> {
  return withSpan(
    "wikipedia.random",
    {},
    fetchFn
  );
}

/**
 * Wrap web scraping for muse mode
 */
export async function tracedWebScrape<T>(
  url: string,
  scrapeFn: () => Promise<T>
): Promise<T> {
  return withSpan(
    "selenium.scrape",
    {
      "scrape.url": url,
    },
    scrapeFn
  );
}
