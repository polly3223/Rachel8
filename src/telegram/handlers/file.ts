import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BotContext } from "../bot.ts";
import { logger } from "../../lib/logger.ts";

const DOWNLOADS_DIR = "/tmp/rachel-downloads";

/** Ensure downloads directory exists */
async function ensureDownloadsDir(): Promise<void> {
  if (!existsSync(DOWNLOADS_DIR)) {
    await mkdir(DOWNLOADS_DIR, { recursive: true });
  }
}

/**
 * Downloads a file from Telegram and saves it locally.
 * Returns the local file path.
 */
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
  const localPath = join(DOWNLOADS_DIR, `${Date.now()}-${fileName}`);
  await writeFile(localPath, Buffer.from(buffer));

  logger.info("File downloaded from Telegram", {
    fileName,
    size: buffer.byteLength,
    localPath,
  });

  return localPath;
}
