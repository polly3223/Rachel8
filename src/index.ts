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
import { setTelegramSender, setAgentExecutor, startTaskPoller, shutdownTasks } from "./lib/tasks.ts";
import { generateResponse } from "./ai/claude.ts";

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

// Connect task system to AI agent so "agent" tasks can trigger autonomous work
setAgentExecutor(async (prompt: string) => {
  // Use a dedicated chat ID for agent-initiated tasks (negative to avoid collision)
  const agentChatId = -1;
  return generateResponse(agentChatId, prompt);
});

// Start the task polling loop
startTaskPoller();

// -- Graceful shutdown --------------------------------------------------------
// Use process.once (not .on) to prevent multiple shutdown attempts

function shutdown(): void {
  shutdownTasks();
  bot.stop();
}

process.once("SIGTERM", () => shutdown()); // systemd sends this on `systemctl stop`
process.once("SIGINT", () => shutdown()); // Ctrl+C in terminal

// -- Start bot ----------------------------------------------------------------
// Long polling keeps the process alive -- replaces the old setInterval keepalive.
// bot.start() returns a Promise that resolves when bot.stop() is called.

// Send startup message before polling starts (bot.api works without polling)
try {
  await bot.api.sendMessage(env.OWNER_TELEGRAM_USER_ID, "I'm back online! 🟢");
  logger.info("Startup message sent");
} catch (err) {
  logger.warn("Could not send startup message", {
    error: err instanceof Error ? err.message : String(err),
  });
}

await bot.start({
  onStart: () => {
    logger.info("Rachel8 is running. Listening for messages...");
  },
});
