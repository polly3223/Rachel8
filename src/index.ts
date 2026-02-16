import { bot } from "./telegram/bot.ts";
import { env } from "./config/env.ts";
import { logger } from "./lib/logger.ts";
import { errorMessage } from "./lib/errors.ts";
import { initializeMemorySystem } from "./lib/memory.ts";
import { setTelegramSender, setAgentExecutor, startTaskPoller, shutdownTasks } from "./lib/tasks.ts";
import { generateResponse } from "./ai/claude.ts";
import { setShuttingDown } from "./lib/state.ts";

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
  setShuttingDown();
  shutdownTasks();
  bot.stop();
}

process.once("SIGTERM", () => shutdown());
process.once("SIGINT", () => shutdown());

// Send startup message (debounced — skip if sent within last 30s to prevent spam on crash loops)
const STARTUP_LOCK = "/tmp/rachel8-startup.lock";
let shouldSendStartup = true;
try {
  const lockFile = Bun.file(STARTUP_LOCK);
  if (await lockFile.exists()) {
    const lastSent = (await lockFile.text()).trim();
    const elapsed = Date.now() - Number(lastSent);
    if (elapsed < 30_000) {
      shouldSendStartup = false;
      logger.info("Skipping startup message (sent recently)");
    }
  }
} catch {
  // Lock file read failed — send anyway
}

if (shouldSendStartup) {
  try {
    await bot.api.sendMessage(env.OWNER_TELEGRAM_USER_ID, "I'm back online! 🟢");
    await Bun.write(STARTUP_LOCK, String(Date.now()));
    logger.info("Startup message sent");
  } catch (err) {
    logger.warn("Could not send startup message", { error: errorMessage(err) });
  }
}

await bot.start({
  onStart: () => {
    logger.info("Rachel8 is running. Listening for messages...");
  },
});
