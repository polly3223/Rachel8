import { bot } from "./telegram/bot.ts";
import { env } from "./config/env.ts";
import { existsSync } from "node:fs";
import { initializeMemorySystem } from "./lib/memory.ts";
import { logger } from "./lib/logger.ts";
import { setLoginNotifier, shutdownLoginSession } from "./lib/login-session.ts";
import { cancelConnectorSession, setConnectorNotifier } from "./lib/connector-session.ts";
import { botCommandsForProvider } from "./telegram/commands.ts";
import { startRuntime, shutdownRuntime } from "./lib/runtime.ts";
import { sendChunks } from "./telegram/delivery.ts";

if (existsSync("/.dockerenv") || Bun.env["RACHEL_CLOUD"] === "true")
  throw new Error("Rachel8 polling requires a standalone host and its own Telegram bot.");
await initializeMemorySystem();
await bot.init();
await bot.api
  .setMyCommands([...botCommandsForProvider(env.AI_PROVIDER)])
  .catch(() => logger.warn("Could not sync Telegram command menu"));
const notify = (text: string) => sendChunks(env.OWNER_TELEGRAM_USER_ID, text, false);
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
    bot.stop(),
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
await bot.start({ onStart: () => logger.info("Rachel8 is running (polling mode)") });
