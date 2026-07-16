import { writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BotContext } from "../bot.ts";
import { env } from "../../config/env.ts";
import { logger } from "../../lib/logger.ts";

const DOWNLOADS_DIR = join(env.SHARED_FOLDER_PATH, "telegram-files");

export function safeTelegramFileName(fileName: string): string {
  const safeName = basename(fileName)
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return safeName || "file";
}

async function ensureDownloadsDir(): Promise<void> {
  await mkdir(DOWNLOADS_DIR, { recursive: true });
}

export async function downloadTelegramFile(
  ctx: BotContext,
  fileId: string,
  fileName: string,
): Promise<string> {
  await ensureDownloadsDir();

  const file = await ctx.api.getFile(fileId);
  const filePath = file.file_path;

  if (!filePath) {
    throw new Error("Telegram did not return a file path");
  }

  const url = `https://api.telegram.org/file/bot${ctx.api.token}/${filePath}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const safeName = safeTelegramFileName(fileName);
  const localPath = join(
    DOWNLOADS_DIR,
    `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`,
  );
  await writeFile(localPath, Buffer.from(buffer));

  logger.info("File downloaded from Telegram", {
    fileName,
    size: buffer.byteLength,
    localPath,
  });

  return localPath;
}
