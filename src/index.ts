import { bot } from "./telegram/bot.ts";
import { env } from "./config/env.ts";
import { logger } from "./lib/logger.ts";
import { errorMessage } from "./lib/errors.ts";
import { initializeMemorySystem } from "./lib/memory.ts";
import { setTelegramSender, setAgentExecutor, startTaskPoller, shutdownTasks } from "./lib/tasks.ts";
import { generateResponse } from "./ai/claude.ts";

logger.info("Rachel8 starting...", { env: env.NODE_ENV });
logger.info("Configuration loaded", {
  sharedFolder: env.SHARED_FOLDER_PATH,
  logLevel: env.LOG_LEVEL,
});

await initializeMemorySystem();

setTelegramSender(async (text: string) => {
  await bot.api.sendMessage(env.OWNER_TELEGRAM_USER_ID, text);
});

setAgentExecutor(async (prompt: string) => {
  return generateResponse(-1, prompt);
});

startTaskPoller();

function shutdown(): void {
  shutdownTasks();
  bot.stop();
}

process.once("SIGTERM", () => shutdown());
process.once("SIGINT", () => shutdown());

// Send startup message with retry (the old process may still hold the bot token briefly)
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    await bot.api.sendMessage(env.OWNER_TELEGRAM_USER_ID, "I'm back online! 🟢");
    logger.info("Startup message sent");
    break;
  } catch (err) {
    logger.warn(`Startup message attempt ${attempt}/3 failed`, {
      error: errorMessage(err),
    });
    if (attempt < 3) await Bun.sleep(2000);
  }
}

await bot.start({
  onStart: () => {
    logger.info("Rachel8 is running. Listening for messages...");
  },
});
