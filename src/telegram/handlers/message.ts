import type { Message } from "grammy/types";
import type { BotContext } from "../bot.ts";
import { env } from "../../config/env.ts";
import type { AIProvider } from "../../ai/provider.ts";
import { getStore } from "../../ai/session-store.ts";
import { steerConversation } from "../../ai/index.ts";
import { downloadTelegramFile } from "./file.ts";
import { transcribeAudio } from "./transcribe.ts";
import { telegram } from "../delivery.ts";
import { redactRecord } from "../../lib/memory.ts";
import type { Input } from "../../ai/turn.ts";

export const NATIVE_AUDIO_MAX_SECONDS = 600;
export const NATIVE_VIDEO_MAX_SECONDS = 300;
export const NATIVE_MEDIA_MAX_BYTES = 15 * 1024 * 1024;

export function useNativeMedia(
  kind: "audio" | "video",
  provider: AIProvider = env.AI_PROVIDER,
  durationSeconds?: number,
  fileBytes?: number,
): boolean {
  if (provider !== "antigravity") return false;
  const maxSeconds = kind === "audio" ? NATIVE_AUDIO_MAX_SECONDS : NATIVE_VIDEO_MAX_SECONDS;
  if (durationSeconds !== undefined && durationSeconds > maxSeconds) return false;
  if (fileBytes !== undefined && fileBytes > NATIVE_MEDIA_MAX_BYTES) return false;
  return true;
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export interface BuildInputDeps {
  provider?: AIProvider;
  download?: (fileId: string, name: string, signal?: AbortSignal) => Promise<string>;
  transcribe?: (filePath: string, signal?: AbortSignal) => Promise<string>;
  fileSize?: (filePath: string) => Promise<number | undefined>;
}

export interface Incoming {
  messages: Message[];
  album?: string;
  resumeOf?: number;
  refresh?: boolean;
}
const ephemeral = new Map<number, Incoming>();
export function releaseIncoming(id: number): void {
  ephemeral.delete(id);
}
export function incomingFor(id: number, body: string): Incoming {
  return ephemeral.get(id) ?? (JSON.parse(body) as Incoming);
}

export function messageTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    hour12: false,
  }).format(date);
  return parts.replace(", ", " ");
}
export function messageText(message: Message): string {
  return message.text ?? message.caption ??
    (message.rich_message ? JSON.stringify(message.rich_message) : "");
}
export async function buildInput(
  incoming: Incoming,
  signal?: AbortSignal,
  deps: BuildInputDeps = {},
): Promise<Input> {
  const provider = deps.provider ?? env.AI_PROVIDER;
  const download =
    deps.download ??
    ((fileId: string, name: string, abort?: AbortSignal) =>
      downloadTelegramFile({ api: telegram }, fileId, name, abort));
  const transcribe = deps.transcribe ?? transcribeAudio;
  const fileSize =
    deps.fileSize ??
    (async (filePath: string) => {
      const file = Bun.file(filePath);
      return (await file.exists()) ? file.size : undefined;
    });
  const texts: string[] = [],
    images: string[] = [];
  const visited = new Set<string>();
  async function read(message: Message, quoted = false): Promise<void> {
    signal?.throwIfAborted();
    texts.push(
      `${quoted ? "Quoted message (context): " : ""}${messageTime(message.date)} [Telegram message ${message.message_id}] ${messageText(message)}`,
    );
    if (!quoted && message.reply_to_message) await read(message.reply_to_message, true);
    let media:
        | { file_id: string; file_name?: string; mime_type?: string; duration?: number; file_size?: number }
        | undefined,
      name = "file",
      image = false,
      audio = false,
      video = false;
    if (message.photo) {
      media = message.photo.at(-1);
      name = "photo.jpg";
      image = true;
    } else if (message.document) {
      media = message.document;
      name = media.file_name ?? name;
      const mime = media.mime_type ?? "";
      image = /\.(png|jpe?g|webp)$/i.test(name);
      audio = /\.(ogg|opus|mp3|m4a|wav|aac|flac)$/i.test(name) || /^audio\//i.test(mime);
      video = /\.(mp4|mov|webm|m4v)$/i.test(name) || /^video\//i.test(mime);
    } else if (message.voice) {
      media = message.voice;
      name = "voice.ogg";
      audio = true;
    } else if (message.audio) {
      media = message.audio;
      name = media.file_name ?? "audio.mp3";
      audio = true;
    } else if (message.video) {
      media = message.video;
      name = media.file_name ?? "video.mp4";
      video = true;
    } else if (message.video_note) {
      media = message.video_note;
      name = "video-note.mp4";
      video = true;
    } else if (message.animation) {
      media = message.animation;
      name = media.file_name ?? "animation.mp4";
      video = true;
    } else if (message.sticker) {
      media = message.sticker;
      name = message.sticker.is_animated
        ? "sticker.tgs"
        : message.sticker.is_video
          ? "sticker.webm"
          : "sticker.webp";
      image = name.endsWith("webp");
      texts.push(`Sticker: ${message.sticker.emoji ?? ""}`);
    }
    if (media && !visited.has(media.file_id)) {
      visited.add(media.file_id);
      const path = await download(media.file_id, name, signal);
      texts.push(`Attachment saved at: ${path}`);
      if (image) images.push(path);
      if (audio || video) {
        const size = media.file_size ?? (await fileSize(path));
        const dur = formatDuration(media.duration);
        if (audio) {
          if (useNativeMedia("audio", provider, media.duration, size)) {
            texts.push(
              `Native audio attachment${dur ? ` (${dur})` : ""}: call read_file on ${path} to listen directly before replying.`,
            );
          } else {
            try {
              const transcript = await transcribe(path, signal);
              texts.push(
                provider === "antigravity"
                  ? `Audio transcript (Groq fallback for long audio${dur ? `, ${dur}` : ""}): ${transcript}`
                  : `Audio transcript: ${transcript}`,
              );
            } catch {
              signal?.throwIfAborted();
              texts.push("Automatic transcription failed; the original audio is saved above.");
            }
          }
        } else if (video) {
          if (useNativeMedia("video", provider, media.duration, size)) {
            texts.push(
              `Native video attachment${dur ? ` (${dur})` : ""}: call read_file on ${path} to inspect it directly before replying.`,
            );
          } else if (provider === "antigravity") {
            texts.push(
              `Video attachment${dur ? ` (${dur})` : ""} exceeds the inline native limit; inspect it selectively if needed.`,
            );
          }
        }
      }
    }
    if ("location" in message) texts.push(`Location: ${JSON.stringify(message.location)}`);
    if ("contact" in message) texts.push(`Shared contact: ${JSON.stringify(message.contact)}`);
    if ("poll" in message) texts.push(`Poll: ${JSON.stringify(message.poll)}`);
  }
  for (const message of incoming.messages) await read(message);
  return { text: texts.join("\n\n"), images };
}

/** Persist before returning to grammY, so its polling loop can immediately accept controls. */
export function acceptMessage(ctx: BotContext): void {
  if (!ctx.message || !ctx.chat) return;
  const store = getStore(),
    message = ctx.message;
  const run = store.db
    .transaction(() => {
      if (store.db.query("SELECT id FROM telegram_updates WHERE id=?").get(ctx.update.update_id))
        return null;
      const album = "media_group_id" in message ? message.media_group_id : undefined;
      const existing = album
        ? (store.db
            .query(
              "SELECT id,body FROM runs WHERE kind='telegram' AND key=? AND state='queued' AND json_extract(body,'$.album')=?",
            )
            .get(String(ctx.chat!.id), album) as { id: number; body: string } | null)
        : null;
      const body: Incoming = existing
        ? incomingFor(existing.id, existing.body)
        : { messages: [], ...(album ? { album } : {}) };
      body.messages.push(message);
      const raw = JSON.stringify(body),
        redacted = JSON.stringify(redactRecord(body));
      const result = existing
        ? store.get(existing.id)!
        : store.enqueue(
            "telegram",
            String(ctx.chat!.id),
            redactRecord(body),
            null,
            Date.now() + (album ? 1200 : 0),
          );
      store.db.run("UPDATE runs SET body=?,created_at=? WHERE id=?", [
        redacted,
        Date.now() + (album ? 1200 : 0),
        result.id,
      ]);
      store.db.run("INSERT INTO telegram_updates(id,run_id) VALUES(?,?)", [
        ctx.update.update_id,
        result.id,
      ]);
      if (raw !== redacted) ephemeral.set(result.id, body);
      return album ? null : { ...result, body: redacted };
    })
    .immediate();
  if (!run || !message.text || message.reply_to_message) return;
  // Native steering has its own acknowledgement; ambiguous interruptions are never replayed.
  store.db.run("UPDATE runs SET state='steering' WHERE id=?", [run.id]);
  void steerConversation(ctx.chat.id, {
    text: `${messageTime(message.date)} ${message.text}`,
  }).then(
    (steered) => {
      store.db.run("UPDATE runs SET state=?,delivered=? WHERE id=? AND state='steering'", [
        steered ? "steered" : "queued",
        steered ? -1 : 0,
        run.id,
      ]);
      if (steered) ephemeral.delete(run.id);
    },
    (error) => {
      if (store.get(run.id)?.state !== "steering") return;
      if (/no active turn|not in progress|expected turn|turn.*mismatch/i.test(String(error)))
        store.db.run("UPDATE runs SET state='queued' WHERE id=?", [run.id]);
      else
        store.finish(run.id, "interrupted", {
          text: `I couldn't confirm delivery of the follow-up (#${run.id}). Use /status before resuming it.`,
        });
    },
  );
}
