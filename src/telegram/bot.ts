import { Bot, type Context, GrammyError, HttpError } from "grammy";
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
import { acceptMessage } from "./handlers/message.ts";
import { answerConversation } from "../ai/index.ts";
import { getStore } from "../ai/session-store.ts";
import { stopWork } from "../lib/runtime.ts";
import { codexCapabilities } from "../ai/codex.ts";
import { sendChunks } from "./delivery.ts";

export type BotContext = Context;
export const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);
bot.use(authGuard);
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
for (const { command, effort } of EFFORT_SET_COMMANDS)
  bot.command(command, (ctx) => handleSetEffort(ctx, effort));
bot.command("refresh", (ctx) => {
  getStore().enqueue("telegram", String(ctx.chat.id), { messages: [], refresh: true });
  return ctx.reply("Context refresh queued. I’ll save a handoff before switching threads.");
});
bot.command("status", (ctx) => {
  const runs = getStore().recent(8);
  return ctx.reply(
    runs.length
      ? runs
          .map((r) => {
            const usage = r.usage
              ? (JSON.parse(r.usage) as { last?: { totalTokens?: number } })
              : null;
            return `#${r.id} ${r.key}: ${r.state} · ${r.activity}${usage?.last?.totalTokens ? ` · last request ${usage.last.totalTokens.toLocaleString()} tokens` : ""}${r.attempts ? ` · delivery attempts ${r.attempts}/6` : ""}`;
          })
          .join("\n")
      : "No work queued.",
  );
});
bot.command("stop", (ctx) => {
  const requested = ctx.match.trim();
  const current = getStore()
    .db.query("SELECT id FROM runs WHERE key=? AND state='running' LIMIT 1")
    .get(String(ctx.chat.id)) as { id: number } | null;
  const id = requested ? Number(requested) : current?.id;
  if (requested && (!Number.isSafeInteger(id) || !id || id < 1))
    return ctx.reply("Use /stop or /stop <work ID>.");
  if (!requested) getStore().cancelQueued(String(ctx.chat.id));
  try {
    if (id) stopWork(id);
    return ctx.reply(
      id ? `Stopping work #${id}.` : "Queued work cancelled; nothing is running in this chat.",
    );
  } catch (error) {
    return ctx.reply(String(error));
  }
});
bot.command("resume", (ctx) => {
  try {
    const run = getStore().resume(Number(ctx.match));
    return ctx.reply(`Recovery queued as work #${run.id}.`);
  } catch (error) {
    return ctx.reply(String(error));
  }
});
bot.command("retry_delivery", (ctx) => {
  const id = Number(ctx.match),
    run = getStore().get(id);
  if (!run?.result || run.delivered === -1)
    return ctx.reply("Choose an undelivered result from /status.");
  getStore().db.run("UPDATE runs SET attempts=0,next_delivery=0 WHERE id=?", [id]);
  return ctx.reply(`Delivery retry queued for #${id}; the work will not run again.`);
});
bot.command("answer", (ctx) =>
  ctx.reply(
    answerConversation(ctx.chat.id, ctx.match)
      ? "Answer received."
      : "There is no pending question in this chat.",
  ),
);
bot.command("capabilities", (ctx) => {
  // Read-only discovery may wait on remote MCPs; it must not block control intake.
  void codexCapabilities()
    .then((data) =>
      sendChunks(
        ctx.chat.id,
        `Configured connectors:\n${JSON.stringify(data, null, 2)}\n\nLocal skills: skills/ and .agents/skills/. Built-in controls: /status, /stop, /resume, /answer.`,
      ),
    )
    .catch(() =>
      sendChunks(
        ctx.chat.id,
        "Connector discovery is unavailable. Local files, shell, skills and task controls remain available.",
      ),
    );
});
bot.on("message", acceptMessage);
bot.catch((err) => {
  const e = err.error;
  logger.error(`Error handling update ${err.ctx.update.update_id}`, {
    error:
      e instanceof GrammyError
        ? e.description
        : e instanceof HttpError || e instanceof Error
          ? e.message
          : String(e),
  });
});
