import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { env } from "../config/env.ts";
import { sendArtifact } from "./delivery.ts";

export const DEFAULT_ELEVENLABS_VOICE_ID = "cgSgspJ2msm6clMCkdW9";
export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_v4_turbo";
export const DEFAULT_ELEVENLABS_SPEED = 1.15;
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

export function resolveSpeed(
  explicit?: number,
  envSpeed = Bun.env["ELEVENLABS_VOICE_SPEED"],
): number {
  const value = explicit ?? (envSpeed?.trim() ? Number(envSpeed) : DEFAULT_ELEVENLABS_SPEED);
  if (!Number.isFinite(value) || value < 0.7 || value > 1.2) {
    throw new Error(`Invalid ElevenLabs voice speed (${value}); expected 0.7..1.2`);
  }
  return value;
}

export async function resolveAmbientPath(
  sharedDir = env.SHARED_FOLDER_PATH,
  envPath = Bun.env["ELEVENLABS_AMBIENT_PATH"],
): Promise<string | null> {
  const configured = envPath?.trim();
  if (configured?.toLowerCase() === "none" || configured?.toLowerCase() === "off") return null;
  const candidate = configured || join(sharedDir, "voice", "ambient-office.mp3");
  return (await Bun.file(candidate).exists()) ? candidate : null;
}

export async function mixAmbientAudio(
  rawVoicePath: string,
  ambientPath: string,
  outputPath: string,
): Promise<boolean> {
  const offset = (Math.random() * 10).toFixed(2);
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-v",
      "error",
      "-i",
      rawVoicePath,
      "-stream_loop",
      "-1",
      "-ss",
      offset,
      "-i",
      ambientPath,
      "-filter_complex",
      "[1:a]highpass=f=90,lowpass=f=4500,volume=+18.0dB,afade=t=in:d=0.15[amb];" +
        "[0:a]adelay=180|180,apad=pad_dur=0.25[v];" +
        "[v][amb]amix=inputs=2:duration=first:normalize=0[out]",
      "-map",
      "[out]",
      "-c:a",
      "libopus",
      "-b:a",
      "64k",
      "-ar",
      "48000",
      "-ac",
      "1",
      outputPath,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  return (await proc.exited) === 0 && (await Bun.file(outputPath).exists());
}

export interface SynthesizeOptions {
  voiceId?: string;
  modelId?: string;
  speed?: number;
  apiKey?: string;
  sharedDir?: string;
  fetchImpl?: typeof fetch;
}

export interface SynthesizedSpeech {
  audio: Uint8Array;
  voiceId: string;
  modelId: string;
  speed: number;
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
  const speed = resolveSpeed(options.speed);
  const fetcher = options.fetchImpl ?? fetch;

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/opus",
    },
    body: JSON.stringify({ text, model_id: modelId, voice_settings: { speed } }),
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
  return { audio, voiceId, modelId, speed, characters: text.length, creditsUsed };
}

export async function speakToOwner(
  text: string,
  options: { caption?: string; voiceId?: string; modelId?: string; speed?: number } = {},
) {
  const result = await synthesizeSpeech(text, {
    voiceId: options.voiceId,
    modelId: options.modelId,
    speed: options.speed,
  });
  const dir = join(env.SHARED_FOLDER_PATH, "telegram-files");
  await mkdir(dir, { recursive: true });
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const rawPath = join(dir, `voice-${id}-raw.ogg`);
  const finalPath = join(dir, `voice-${id}.ogg`);
  const ambientPath = await resolveAmbientPath();
  let deliveredPath = finalPath;
  let ambientMixed = false;

  if (ambientPath) {
    await Bun.write(rawPath, result.audio);
    ambientMixed = await mixAmbientAudio(rawPath, ambientPath, finalPath).catch(() => false);
    if (ambientMixed) {
      await unlink(rawPath).catch(() => {});
    } else {
      deliveredPath = rawPath;
    }
  } else {
    await Bun.write(finalPath, result.audio);
  }

  const messageId = await sendArtifact(env.OWNER_TELEGRAM_USER_ID, deliveredPath, options.caption);
  return {
    messageId,
    path: deliveredPath,
    voiceId: result.voiceId,
    modelId: result.modelId,
    speed: result.speed,
    ambientMixed,
    characters: result.characters,
    creditsUsed: result.creditsUsed,
  };
}
