import { Api, InputFile, GrammyError } from "grammy";
import { basename } from "node:path";
import { env } from "../config/env.ts";
import { splitTelegramMessage, TELEGRAM_MESSAGE_LIMIT } from "./message-chunks.ts";

export const telegram = new Api(env.TELEGRAM_BOT_TOKEN);
export const shouldSend = (text: string) =>
  !/^(?:no response (?:requested|needed)\.?\s*)?$/i.test(text.trim());
export async function sendText(chat: number, text: string, markdown = true): Promise<number> {
  if (!markdown) return (await telegram.sendMessage(chat, text)).message_id;
  try {
    return (await telegram.sendRichMessage(chat, { markdown: text })).message_id;
  } catch (error) {
    if (
      !(error instanceof GrammyError) ||
      error.error_code !== 400 ||
      !/parse|can't find end|rich.message|too many (?:blocks|columns)|nesting/i.test(error.description)
    )
      throw error;
    // One successful message/receipt per outbox item, even when formatting is rejected.
    return (await telegram.sendRichMessage(chat, {
      blocks: [{ type: "paragraph", text }],
    })).message_id;
  }
}
export async function sendChunks(chat: number, text: string, markdown = true): Promise<void> {
  if (shouldSend(text))
    for (const chunk of splitTelegramMessage(text, markdown ? undefined : TELEGRAM_MESSAGE_LIMIT))
      await sendText(chat, chunk, markdown);
}
export function fileMethod(
  path: string,
  original = false,
): "sendDocument" | "sendAnimation" | "sendPhoto" | "sendVideo" | "sendAudio" {
  if (original) return "sendDocument";
  if (/\.gif$/i.test(path)) return "sendAnimation";
  if (/\.(png|jpe?g)$/i.test(path)) return "sendPhoto";
  if (/\.(mp4|mov)$/i.test(path)) return "sendVideo";
  if (/\.(mp3|m4a)$/i.test(path)) return "sendAudio";
  return "sendDocument";
}
export async function sendArtifact(
  chat: number,
  path: string,
  caption?: string,
  original = false,
): Promise<number> {
  if (!(await Bun.file(path).exists())) throw new Error(`File not found: ${path}`);
  const file = new InputFile(path, basename(path));
  const result = await telegram[fileMethod(path, original)](chat, file, { caption });
  return result.message_id;
}
