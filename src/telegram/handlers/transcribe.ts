import { logger } from "../../lib/logger.ts";

/**
 * Speech-to-text via 3rd party API.
 *
 * Supports two providers (set STT_PROVIDER env var):
 *   - "groq"   (default) — free Whisper API via Groq (whisper-large-v3-turbo)
 *   - "openai"           — OpenAI Whisper API ($0.006/min)
 *
 * Required env vars:
 *   GROQ_API_KEY   — for Groq provider
 *   OPENAI_API_KEY — for OpenAI provider
 */

const STT_PROVIDER = (process.env["STT_PROVIDER"] ?? "groq").toLowerCase();

function getConfig(): { url: string; apiKey: string; model: string } {
  if (STT_PROVIDER === "openai") {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) throw new Error("OPENAI_API_KEY not set — required for OpenAI STT");
    return {
      url: "https://api.openai.com/v1/audio/transcriptions",
      apiKey,
      model: "whisper-1",
    };
  }

  // Default: Groq (free, fast)
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new Error("GROQ_API_KEY not set — required for Groq STT");
  return {
    url: "https://api.groq.com/openai/v1/audio/transcriptions",
    apiKey,
    model: "whisper-large-v3-turbo",
  };
}

// Validate on startup
try {
  getConfig();
  logger.info(`STT ready: provider=${STT_PROVIDER}`);
} catch (e) {
  logger.warn(`STT not configured: ${e instanceof Error ? e.message : String(e)}`);
}

export async function transcribeAudio(filePath: string): Promise<string> {
  const t0 = performance.now();
  const config = getConfig();

  const bunFile = Bun.file(filePath);
  if (!(await bunFile.exists())) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  // Read file into a Blob and wrap as File with proper name
  // (Groq/OpenAI need the filename extension to detect format)
  const bytes = await bunFile.arrayBuffer();
  const fileName = filePath.split("/").pop() ?? "audio.ogg";
  const blob = new Blob([bytes], { type: bunFile.type });
  const file = new File([blob], fileName, { type: bunFile.type });

  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", config.model);

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`STT API error (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as { text: string };
  const text = result.text?.trim() ?? "";

  const elapsed = (performance.now() - t0).toFixed(0);
  logger.info(`STT completed in ${elapsed}ms`, {
    provider: STT_PROVIDER,
    model: config.model,
    textLength: text.length,
  });

  return text;
}
