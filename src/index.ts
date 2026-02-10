/**
 * Rachel8 entry point.
 *
 * Starts the Telegram bot in long polling mode. The bot authenticates
 * the owner, shows typing indicators, and responds via Claude.
 */

import { bot } from "./telegram/bot.ts";
import { env } from "./config/env.ts";
import { logger } from "./lib/logger.ts";
import { initializeMemorySystem } from "./lib/memory.ts";
import { setTelegramSender, shutdownTasks } from "./lib/tasks.ts";

// -- Startup ------------------------------------------------------------------

logger.info("Rachel8 starting...", { env: env.NODE_ENV });

logger.info("Configuration loaded", {
  sharedFolder: env.SHARED_FOLDER_PATH,
  logLevel: env.LOG_LEVEL,
});

// Initialize memory system
await initializeMemorySystem();

// Connect task system to Telegram so it can send reminders
setTelegramSender(async (text: string) => {
  await bot.api.sendMessage(env.OWNER_TELEGRAM_USER_ID, text);
});

// -- Graceful shutdown --------------------------------------------------------
// Use process.once (not .on) to prevent multiple shutdown attempts

async function shutdown(): Promise<void> {
  await shutdownTasks();
  bot.stop();
}

process.once("SIGTERM", () => void shutdown()); // systemd sends this on `systemctl stop`
process.once("SIGINT", () => void shutdown()); // Ctrl+C in terminal

// -- Start bot ----------------------------------------------------------------
// Long polling keeps the process alive -- replaces the old setInterval keepalive.
// bot.start() returns a Promise that resolves when bot.stop() is called.

await bot.start({
  onStart: async () => {
    logger.info("Rachel8 is running. Listening for messages...");
    try {
      await bot.api.sendMessage(env.OWNER_TELEGRAM_USER_ID, "I'm back online!");
    } catch (err) {
      logger.warn("Could not send startup message", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
