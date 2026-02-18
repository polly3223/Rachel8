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
  if (!isWebhookMode) bot.stop();
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

// ---------------------------------------------------------------------------
// Startup mode: webhook (Rachel Cloud containers) vs polling (standalone)
//
// In Rachel Cloud, RACHEL_CLOUD=true is set. The central router at
// get-rachel.com/api/telegram/webhook receives ALL updates from Telegram
// and forwards them to containers via POST http://rachel-user-{id}:8443/webhook.
//
// Standalone instances (like the host Rachel) use traditional long polling.
// ---------------------------------------------------------------------------

const isWebhookMode = Bun.env.RACHEL_CLOUD === "true";

if (isWebhookMode) {
  const WEBHOOK_PORT = Number(Bun.env.WEBHOOK_PORT || "8443");

  // Initialize grammY bot internals without polling
  await bot.init();

  const server = Bun.serve({
    port: WEBHOOK_PORT,
    async fetch(req: Request) {
      const url = new URL(req.url);

      // Health check endpoint
      if (req.method === "GET" && url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Webhook endpoint — receives raw Telegram updates from the router
      if (req.method === "POST" && url.pathname === "/webhook") {
        try {
          const update = await req.json();
          await bot.handleUpdate(update);
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          logger.error("Webhook handler error", { error: errorMessage(err) });
          return new Response(JSON.stringify({ ok: false }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });

  logger.info(`Rachel8 webhook server listening on port ${WEBHOOK_PORT}`);
} else {
  // Standalone mode — use long polling (only 1 instance per bot token!)
  await bot.start({
    onStart: () => {
      logger.info("Rachel8 is running (polling mode). Listening for messages...");
    },
  });
}
