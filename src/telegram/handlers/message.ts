import type { BotContext } from "../bot.ts";
import { generateResponse } from "../../ai/claude.ts";
import { logger } from "../../lib/logger.ts";
import { errorMessage } from "../../lib/errors.ts";
import { downloadTelegramFile } from "./file.ts";
import { transcribeAudio } from "./transcribe.ts";

function withErrorHandling(
  mediaType: string,
  handler: (ctx: BotContext) => Promise<void>,
): (ctx: BotContext) => Promise<void> {
  return async function (ctx: BotContext): Promise<void> {
    ctx.chatAction = "typing";
    try {
      await handler(ctx);
    } catch (error) {
      logger.error(`Failed to handle ${mediaType}`, {
        error: errorMessage(error),
      });
      await ctx.reply(`Sorry, I couldn't process that ${mediaType}. Please try again.`);
    }
  };
}

export const handleMessage = withErrorHandling("message", async (ctx) => {
  const text = ctx.message?.text;
  if (!text) return;

  const response = await generateResponse(ctx.chat.id, text);
  await ctx.reply(response);
});

export const handlePhoto = withErrorHandling("image", async (ctx) => {
  const photos = ctx.message?.photo;
  if (!photos?.length) return;

  const photo = photos[photos.length - 1];
  const localPath = await downloadTelegramFile(ctx, photo.file_id, "photo.jpg");

  const caption = ctx.message?.caption ?? "I sent you an image. What do you see?";
  const prompt = `[User sent an image saved at: ${localPath}]\n\n${caption}`;

  const response = await generateResponse(ctx.chat.id, prompt);
  await ctx.reply(response);
});

export const handleDocument = withErrorHandling("file", async (ctx) => {
  const doc = ctx.message?.document;
  if (!doc) return;

  const fileName = doc.file_name ?? "document";
  const localPath = await downloadTelegramFile(ctx, doc.file_id, fileName);

  const caption = ctx.message?.caption ?? `I sent you a file: ${fileName}`;
  const prompt = `[User sent a file saved at: ${localPath} (filename: ${fileName})]\n\n${caption}`;

  const response = await generateResponse(ctx.chat.id, prompt);
  await ctx.reply(response);
});

export const handleVoice = withErrorHandling("voice message", async (ctx) => {
  const voice = ctx.message?.voice;
  if (!voice) return;

  const localPath = await downloadTelegramFile(ctx, voice.file_id, "voice.ogg");
  const transcription = await transcribeAudio(localPath);
  logger.info("Voice message transcribed", { transcription });

  const caption = ctx.message?.caption;
  const prompt = caption
    ? `[Voice message transcribed: "${transcription}"]\n\n${caption}`
    : transcription;

  const response = await generateResponse(ctx.chat.id, prompt);
  await ctx.reply(response);
});

export const handleAudio = withErrorHandling("audio file", async (ctx) => {
  const audio = ctx.message?.audio;
  if (!audio) return;

  const extension = audio.mime_type?.split("/")[1] ?? "mp3";
  const fileName = audio.file_name ?? `audio.${extension}`;
  const localPath = await downloadTelegramFile(ctx, audio.file_id, fileName);

  const transcription = await transcribeAudio(localPath);
  logger.info("Audio file transcribed", { fileName, transcription });

  const caption = ctx.message?.caption ?? `I sent you an audio file: ${fileName}`;
  const prompt = `[Audio file "${fileName}" transcribed: "${transcription}"]\n\n${caption}`;

  const response = await generateResponse(ctx.chat.id, prompt);
  await ctx.reply(response);
});

export const handleVideo = withErrorHandling("video", async (ctx) => {
  const video = ctx.message?.video;
  if (!video) return;

  const fileName = video.file_name ?? "video.mp4";
  const localPath = await downloadTelegramFile(ctx, video.file_id, fileName);

  const caption = ctx.message?.caption ?? `I sent you a video: ${fileName}`;
  const prompt = `[User sent a video saved at: ${localPath} (filename: ${fileName}, duration: ${video.duration}s)]\n\n${caption}`;

  const response = await generateResponse(ctx.chat.id, prompt);
  await ctx.reply(response);
});

export const handleVideoNote = withErrorHandling("video note", async (ctx) => {
  const videoNote = ctx.message?.video_note;
  if (!videoNote) return;

  const localPath = await downloadTelegramFile(ctx, videoNote.file_id, "video_note.mp4");
  const prompt = `[User sent a video note (round video) saved at: ${localPath} (duration: ${videoNote.duration}s)]\n\nI sent you a video note.`;

  const response = await generateResponse(ctx.chat.id, prompt);
  await ctx.reply(response);
});

export const handleSticker = withErrorHandling("sticker", async (ctx) => {
  const sticker = ctx.message?.sticker;
  if (!sticker) return;

  const emoji = sticker.emoji ?? "";
  const setName = sticker.set_name ?? "unknown";

  let prompt: string;
  if (sticker.is_animated || sticker.is_video) {
    prompt = `[User sent a sticker: emoji ${emoji}, from set "${setName}"]`;
  } else {
    const localPath = await downloadTelegramFile(ctx, sticker.file_id, "sticker.webp");
    prompt = `[User sent a sticker saved at: ${localPath} (emoji: ${emoji}, set: "${setName}")]`;
  }

  const response = await generateResponse(ctx.chat.id, prompt);
  await ctx.reply(response);
});
