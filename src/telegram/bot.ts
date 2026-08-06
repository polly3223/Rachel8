import { Bot, type Context, GrammyError, HttpError } from "grammy";
import { autoChatAction, type AutoChatActionFlavor } from "@grammyjs/auto-chat-action";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { authGuard } from "./middleware/auth.ts";
import {
  handleLogin,
  handleLoginCancel,
  handleLoginCode,
  handleLoginStatus,
} from "./handlers/auth.ts";
import {
  handleConnectorCallback,
  handleConnectorCancel,
  handleConnectorConnect,
  handleConnectorStatus,
} from "./handlers/connectors.ts";
import { EFFORT_SET_COMMANDS } from "./commands.ts";
import { handleEffort, handleSetEffort } from "./handlers/effort.ts";
import { handleHelp } from "./handlers/help.ts";
import { handleContextRefresh } from "./handlers/context-refresh.ts";
import {
  handleMessage,
  handlePhoto,
  handleDocument,
  handleVoice,
  handleAudio,
  handleVideo,
  handleVideoNote,
  handleSticker,
} from "./handlers/message.ts";

export type BotContext = Context & AutoChatActionFlavor;

export const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

bot.use(authGuard);
bot.use(autoChatAction());

bot.command("start", (ctx) => ctx.reply("Hello! I'm Rachel, your personal AI assistant."));
bot.command("help", handleHelp);
bot.command("login", handleLogin);
bot.command("login_code", handleLoginCode);
bot.command("login_cancel", handleLoginCancel);
bot.command("login_status", handleLoginStatus);
bot.command("connector_connect", handleConnectorConnect);
bot.command("connector_callback", handleConnectorCallback);
bot.command("connector_cancel", handleConnectorCancel);
bot.command("connector_status", handleConnectorStatus);
bot.command("effort", handleEffort);
bot.command("refresh", handleContextRefresh);
for (const { command, effort } of EFFORT_SET_COMMANDS) {
  bot.command(command, (ctx) => handleSetEffort(ctx, effort));
}

bot.on("message:text", handleMessage);
bot.on("message:photo", handlePhoto);
bot.on("message:document", handleDocument);
bot.on("message:voice", handleVoice);
bot.on("message:audio", handleAudio);
bot.on("message:video", handleVideo);
bot.on("message:video_note", handleVideoNote);
bot.on("message:sticker", handleSticker);

function formatBotError(e: unknown): string {
  if (e instanceof GrammyError) return e.description;
  if (e instanceof HttpError) return `Network error: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

bot.catch((err) => {
  logger.error(`Error handling update ${err.ctx.update.update_id}`, {
    error: formatBotError(err.error),
  });
});
