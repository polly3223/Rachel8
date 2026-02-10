/**
 * Rachel8 entry point.
 *
 * Starts the Telegram bot in long polling mode. The bot authenticates
 * the owner, shows typing indicators, and responds via Claude.
 */

import { bot } from "./telegram/bot.ts";
import { env } from "./config/env.ts";
import { logger } from "./lib/logger.ts";

// -- Startup ------------------------------------------------------------------

logger.info("Rachel8 starting...", { env: env.NODE_ENV });

logger.info("Configuration loaded", {
  sharedFolder: env.SHARED_FOLDER_PATH,
  logLevel: env.LOG_LEVEL,
});

// -- Graceful shutdown --------------------------------------------------------
// Use process.once (not .on) to prevent multiple shutdown attempts

process.once("SIGTERM", () => bot.stop()); // systemd sends this on `systemctl stop`
process.once("SIGINT", () => bot.stop()); // Ctrl+C in terminal

// -- Start bot ----------------------------------------------------------------
// Long polling keeps the process alive -- replaces the old setInterval keepalive.
// bot.start() returns a Promise that resolves when bot.stop() is called.

await bot.start({
  onStart: () => logger.info("Rachel8 is running. Listening for messages..."),
});
