import type { Update } from "grammy/types";
import { bot } from "./telegram/bot.ts";
import { env } from "./config/env.ts";
import { existsSync } from "node:fs";
import { initializeMemorySystem } from "./lib/memory.ts";
import { logger } from "./lib/logger.ts";
import { setLoginNotifier, shutdownLoginSession } from "./lib/login-session.ts";
import { cancelConnectorSession, setConnectorNotifier } from "./lib/connector-session.ts";
import { BOT_COMMANDS } from "./telegram/commands.ts";
import { startRuntime, shutdownRuntime } from "./lib/runtime.ts";
import { sendChunks } from "./telegram/delivery.ts";

const webhook = Bun.env["RACHEL_CLOUD"] === "true";
if (existsSync("/.dockerenv") && !webhook)
  throw new Error("Container polling is disabled: set RACHEL_CLOUD=true");
await initializeMemorySystem();
await bot.init();
await bot.api
  .setMyCommands([...BOT_COMMANDS])
  .catch(() => logger.warn("Could not sync Telegram command menu"));
const notify = (text: string) => sendChunks(env.OWNER_TELEGRAM_USER_ID, text);
setLoginNotifier(notify);
setConnectorNotifier(notify);
startRuntime();
let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  shutdownLoginSession();
  await Promise.allSettled([
    shutdownRuntime(),
    cancelConnectorSession({ notify: false }),
    webhook ? Promise.resolve() : bot.stop(),
  ]);
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
const startupLock = Bun.file("/tmp/rachel8-startup.lock");
const lastStartup = Number(await startupLock.text().catch(() => "0"));
if (Date.now() - lastStartup > 30_000) {
  await notify("I'm back online!")
    .then(() => Bun.write(startupLock, String(Date.now())))
    .catch(() => logger.warn("Startup notification failed"));
}
if (webhook) {
  Bun.serve({
    port: Number(Bun.env["WEBHOOK_PORT"] ?? "8443"),
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/health") return Response.json({ status: "ok" });
      if (request.method === "POST" && path === "/webhook") {
        try {
          await bot.handleUpdate((await request.json()) as Update);
          return Response.json({ ok: true });
        } catch {
          return Response.json({ ok: false }, { status: 500 });
        }
      }
      return new Response("Not found", { status: 404 });
    },
  });
} else await bot.start({ onStart: () => logger.info("Rachel8 is running (polling mode)") });
