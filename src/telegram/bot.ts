import { Bot, type Context, GrammyError, HttpError } from "grammy";
import { autoChatAction, type AutoChatActionFlavor } from "@grammyjs/auto-chat-action";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { authGuard } from "./middleware/auth.ts";

export type BotContext = Context & AutoChatActionFlavor;

export const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

// Middleware stack — order matters: auth first, then typing indicator
bot.use(authGuard);
bot.use(autoChatAction());

// /start command — friendly greeting
bot.command("start", (ctx) => ctx.reply("Hello! I'm Rachel, your personal AI assistant."));

// Error handler — log and continue, don't crash the polling loop
bot.catch((err) => {
  const ctx = err.ctx;
  const e = err.error;

  logger.error(`Error handling update ${ctx.update.update_id}`, {
    error: e instanceof GrammyError
      ? e.description
      : e instanceof HttpError
        ? `Network error: ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e),
  });
});
