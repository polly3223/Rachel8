import type { BotContext } from "../bot.ts";
import { generateResponse } from "../../ai/claude.ts";
import { logger } from "../../lib/logger.ts";
import { downloadTelegramFile } from "./file.ts";
import { transcribeAudio } from "./transcribe.ts";

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

/** Handle voice messages (recorded via Telegram mic button, OGG format) */
export async function handleVoice(ctx: BotContext): Promise<void> {
  const voice = ctx.message?.voice;
  if (!voice) return;

  ctx.chatAction = "typing";

  try {
    const localPath = await downloadTelegramFile(ctx, voice.file_id, "voice.ogg");

    const transcription = await transcribeAudio(localPath);
    logger.info("Voice message transcribed", { transcription });

    const caption = ctx.message?.caption;
    const prompt = caption
      ? `[Voice message transcribed: "${transcription}"]\n\n${caption}`
      : transcription;

    const response = await generateResponse(ctx.chat.id, prompt);
    await ctx.reply(response);
  } catch (error) {
    logger.error("Failed to handle voice message", {
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply("Sorry, I couldn't process that voice message. Please try again.");
  }
}

/** Handle audio messages (music files, audio files sent via Telegram) */
export async function handleAudio(ctx: BotContext): Promise<void> {
  const audio = ctx.message?.audio;
  if (!audio) return;

  ctx.chatAction = "typing";

  try {
    const fileName = audio.file_name ?? `audio.${audio.mime_type?.split("/")[1] ?? "mp3"}`;
    const localPath = await downloadTelegramFile(ctx, audio.file_id, fileName);

    const transcription = await transcribeAudio(localPath);
    logger.info("Audio file transcribed", { fileName, transcription });

    const caption = ctx.message?.caption ?? `I sent you an audio file: ${fileName}`;
    const prompt = `[Audio file "${fileName}" transcribed: "${transcription}"]\n\n${caption}`;

    const response = await generateResponse(ctx.chat.id, prompt);
    await ctx.reply(response);
  } catch (error) {
    logger.error("Failed to handle audio", {
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply("Sorry, I couldn't process that audio file. Please try again.");
  }
}

/** Handle video messages */
export async function handleVideo(ctx: BotContext): Promise<void> {
  const video = ctx.message?.video;
  if (!video) return;

  ctx.chatAction = "typing";

  try {
    const fileName = video.file_name ?? "video.mp4";
    const localPath = await downloadTelegramFile(ctx, video.file_id, fileName);

    const caption = ctx.message?.caption ?? `I sent you a video: ${fileName}`;
    const prompt = `[User sent a video saved at: ${localPath} (filename: ${fileName}, duration: ${video.duration}s)]\n\n${caption}`;

    const response = await generateResponse(ctx.chat.id, prompt);
    await ctx.reply(response);
  } catch (error) {
    logger.error("Failed to handle video", {
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply("Sorry, I couldn't process that video. Please try again.");
  }
}

/** Handle video notes (round video messages) */
export async function handleVideoNote(ctx: BotContext): Promise<void> {
  const videoNote = ctx.message?.video_note;
  if (!videoNote) return;

  ctx.chatAction = "typing";

  try {
    const localPath = await downloadTelegramFile(ctx, videoNote.file_id, "video_note.mp4");

    const prompt = `[User sent a video note (round video) saved at: ${localPath} (duration: ${videoNote.duration}s)]\n\nI sent you a video note.`;

    const response = await generateResponse(ctx.chat.id, prompt);
    await ctx.reply(response);
  } catch (error) {
    logger.error("Failed to handle video note", {
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply("Sorry, I couldn't process that video note. Please try again.");
  }
}

/** Handle sticker messages */
export async function handleSticker(ctx: BotContext): Promise<void> {
  const sticker = ctx.message?.sticker;
  if (!sticker) return;

  ctx.chatAction = "typing";

  try {
    const emoji = sticker.emoji ?? "";
    const setName = sticker.set_name ?? "unknown";

    // For animated/video stickers we just describe them; for static ones we can download
    if (sticker.is_animated || sticker.is_video) {
      const prompt = `[User sent a sticker: emoji ${emoji}, from set "${setName}"]`;
      const response = await generateResponse(ctx.chat.id, prompt);
      await ctx.reply(response);
    } else {
      const localPath = await downloadTelegramFile(ctx, sticker.file_id, "sticker.webp");
      const prompt = `[User sent a sticker saved at: ${localPath} (emoji: ${emoji}, set: "${setName}")]`;
      const response = await generateResponse(ctx.chat.id, prompt);
      await ctx.reply(response);
    }
  } catch (error) {
    logger.error("Failed to handle sticker", {
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply("Sorry, I couldn't process that sticker. Please try again.");
  }
}
