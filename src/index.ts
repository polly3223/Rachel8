/**
 * Rachel8 entry point.
 *
 * Validates configuration via Zod, registers graceful shutdown handlers,
 * and keeps the process alive for systemd. Later phases will add the
 * Telegram bot, agent SDK, and queue workers here.
 */

import { env } from "./config/env.ts";
import { logger } from "./lib/logger.ts";

// ── Startup ──────────────────────────────────────────────────────────────────

logger.info("Rachel8 starting...", { env: env.NODE_ENV });

// Log config summary (never log API keys or secrets)
logger.info("Configuration loaded", {
  sharedFolder: env.SHARED_FOLDER_PATH,
  logLevel: env.LOG_LEVEL,
});

// ── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(): void {
  logger.info("Shutting down...");
  process.exit(0);
}

process.on("SIGTERM", shutdown); // systemd sends this on `systemctl stop`
process.on("SIGINT", shutdown); // Ctrl+C in terminal

// ── Keep alive ───────────────────────────────────────────────────────────────
// Process stays alive for systemd. Later phases replace this with
// Bun.serve() for the grammY webhook and queue workers.

setInterval(() => {
  logger.debug("heartbeat");
}, 60_000);

logger.info("Rachel8 is running. Waiting for connections...");
