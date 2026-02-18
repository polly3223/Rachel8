#!/usr/bin/env bun
/**
 * Telegram File Sender CLI
 *
 * Standalone script for the Claude agent to send files (images, documents, etc.)
 * to the user via Telegram. This is needed because the agent can only return text
 * responses — it has no direct way to push files through the bot.
 *
 * Usage:
 *   bun run src/telegram/send-file.ts <file-path> [caption]
 *
 * Environment variables (already set in Rachel8):
 *   TELEGRAM_BOT_TOKEN — Bot token
 *   OWNER_TELEGRAM_USER_ID — Chat ID to send to
 *
 * Supports: images (jpg/png/gif/webp), documents (pdf/csv/xlsx/etc), video, audio
 */

const filePath = process.argv[2];
const caption = process.argv.slice(3).join(" ") || undefined;

if (!filePath) {
  console.error("Usage: bun run src/telegram/send-file.ts <file-path> [caption]");
  console.error("Example: bun run src/telegram/send-file.ts /data/whatsapp-qr.png 'Scan this QR code'");
  process.exit(1);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.OWNER_TELEGRAM_USER_ID;

if (!token || !chatId) {
  console.error("Missing TELEGRAM_BOT_TOKEN or OWNER_TELEGRAM_USER_ID env vars");
  process.exit(1);
}

const file = Bun.file(filePath);
if (!(await file.exists())) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const mime = file.type || "application/octet-stream";
const fileName = filePath.split("/").pop() ?? "file";
const blob = await file.arrayBuffer();

// Determine Telegram API method based on MIME type
let method: string;
let fieldName: string;

if (mime.startsWith("image/")) {
  method = "sendPhoto";
  fieldName = "photo";
} else if (mime.startsWith("video/")) {
  method = "sendVideo";
  fieldName = "video";
} else if (mime.startsWith("audio/")) {
  method = "sendAudio";
  fieldName = "audio";
} else {
  method = "sendDocument";
  fieldName = "document";
}

const formData = new FormData();
formData.append("chat_id", chatId);
formData.append(fieldName, new File([blob], fileName, { type: mime }));
if (caption) {
  formData.append("caption", caption);
}

const url = `https://api.telegram.org/bot${token}/${method}`;
const response = await fetch(url, { method: "POST", body: formData });
const result = await response.json() as { ok: boolean; description?: string };

if (result.ok) {
  console.log(`File sent successfully via ${method}: ${fileName}`);
} else {
  console.error(`Failed to send file: ${result.description ?? "Unknown error"}`);
  process.exit(1);
}
