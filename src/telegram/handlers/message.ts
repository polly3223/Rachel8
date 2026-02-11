import type { BotContext } from "../bot.ts";
import { generateResponse } from "../../ai/claude.ts";
import { logger } from "../../lib/logger.ts";
import { downloadTelegramFile } from "./file.ts";

/** Handle plain text messages */
export async function handleMessage(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  ctx.chatAction = "typing";

  try {
    const response = await generateResponse(ctx.chat.id, text);
    await ctx.reply(response);
  } catch (error) {
    logger.error("Failed to generate response", {
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply("Sorry, I encountered an error. Please try again.");
  }
}

/** Handle photo messages (with optional caption) */
export async function handlePhoto(ctx: BotContext): Promise<void> {
  const photos = ctx.message?.photo;
  if (!photos?.length) return;

  ctx.chatAction = "typing";

  try {
    // Get the highest resolution photo (last in array)
    const photo = photos[photos.length - 1];
    const localPath = await downloadTelegramFile(ctx, photo.file_id, "photo.jpg");

    const caption = ctx.message?.caption ?? "I sent you an image. What do you see?";
    const prompt = `[User sent an image saved at: ${localPath}]\n\n${caption}`;

    const response = await generateResponse(ctx.chat.id, prompt);
    await ctx.reply(response);
  } catch (error) {
    logger.error("Failed to handle photo", {
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply("Sorry, I couldn't process that image. Please try again.");
  }
}

/** Handle document messages (PDFs, files, etc.) */
export async function handleDocument(ctx: BotContext): Promise<void> {
  const doc = ctx.message?.document;
  if (!doc) return;

  ctx.chatAction = "typing";

  try {
    const fileName = doc.file_name ?? "document";
    const localPath = await downloadTelegramFile(ctx, doc.file_id, fileName);

    const caption = ctx.message?.caption ?? `I sent you a file: ${fileName}`;
    const prompt = `[User sent a file saved at: ${localPath} (filename: ${fileName})]\n\n${caption}`;

    const response = await generateResponse(ctx.chat.id, prompt);
    await ctx.reply(response);
  } catch (error) {
    logger.error("Failed to handle document", {
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply("Sorry, I couldn't process that file. Please try again.");
  }
}
