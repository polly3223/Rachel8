import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { env } from "../config/env.ts";
import { sendArtifact } from "./delivery.ts";

export const DEFAULT_ELEVENLABS_VOICE_ID = "cgSgspJ2msm6clMCkdW9";
export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_v4_turbo";
export const ELEVENLABS_OUTPUT_FORMAT = "opus_48000_64";
export const MAX_SPEAK_CHARS = 5000;

const vaultSchema = z.object({ api_key: z.string().min(1) });

export async function loadElevenLabsKey(
  sharedDir = env.SHARED_FOLDER_PATH,
  envKey = Bun.env["ELEVENLABS_API_KEY"],
): Promise<string> {
  const configured = envKey?.trim();
  if (configured) return configured;
  const file = Bun.file(join(sharedDir, "vault", "elevenlabs.json"));
  if (await file.exists()) {
    const parsed = vaultSchema.safeParse(await file.json());
    if (parsed.success) return parsed.data.api_key.trim();
  }
  throw new Error(
    "ElevenLabs API key not configured (set ELEVENLABS_API_KEY or vault/elevenlabs.json)",
  );
}

export interface SynthesizeOptions {
  voiceId?: string;
  modelId?: string;
  apiKey?: string;
  sharedDir?: string;
  fetchImpl?: typeof fetch;
}

export interface SynthesizedSpeech {
  audio: Uint8Array;
  voiceId: string;
  modelId: string;
  characters: number;
  creditsUsed: number | null;
}

export async function synthesizeSpeech(
  rawText: string,
  options: SynthesizeOptions = {},
): Promise<SynthesizedSpeech> {
  const text = rawText.trim();
  if (!text) throw new Error("Speech text cannot be empty");
  if (text.length > MAX_SPEAK_CHARS) {
    throw new Error(`Speech text exceeds ${MAX_SPEAK_CHARS} characters (${text.length})`);
  }
  const apiKey = options.apiKey?.trim() || (await loadElevenLabsKey(options.sharedDir));
  const voiceId =
    options.voiceId?.trim() || Bun.env["ELEVENLABS_VOICE_ID"]?.trim() || DEFAULT_ELEVENLABS_VOICE_ID;
  const modelId =
    options.modelId?.trim() || Bun.env["ELEVENLABS_MODEL_ID"]?.trim() || DEFAULT_ELEVENLABS_MODEL_ID;
  const fetcher = options.fetchImpl ?? fetch;

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/opus",
    },
    body: JSON.stringify({ text, model_id: modelId }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`ElevenLabs TTS failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength < 16) throw new Error("ElevenLabs returned empty audio");
  const costHeader = response.headers.get("character-cost");
  const parsedCost = costHeader !== null ? Number(costHeader) : Number.NaN;
  const creditsUsed = Number.isFinite(parsedCost) ? parsedCost : null;
  return { audio, voiceId, modelId, characters: text.length, creditsUsed };
}

export async function speakToOwner(
  text: string,
  options: { caption?: string; voiceId?: string; modelId?: string } = {},
) {
  const result = await synthesizeSpeech(text, {
    voiceId: options.voiceId,
    modelId: options.modelId,
  });
  const dir = join(env.SHARED_FOLDER_PATH, "telegram-files");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `voice-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.ogg`);
  await Bun.write(path, result.audio);
  const messageId = await sendArtifact(env.OWNER_TELEGRAM_USER_ID, path, options.caption);
  return {
    messageId,
    path,
    voiceId: result.voiceId,
    modelId: result.modelId,
    characters: result.characters,
    creditsUsed: result.creditsUsed,
  };
}
