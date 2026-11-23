import type { BotContext } from "../bot.ts";
import { commandArg } from "../../lib/command.ts";
import {
  cancelConnectorSession,
  getConnectorStatusMessage,
  startConnectorSession,
  submitConnectorCallback,
} from "../../lib/connector-session.ts";
import { errorMessage } from "../../lib/errors.ts";
import { logger } from "../../lib/logger.ts";
import { sendChunks } from "../delivery.ts";

async function replyPlain(ctx: BotContext, action: () => Promise<string>): Promise<void> {
  if (!ctx.chat) return;
  try {
    // Plain text preserves OAuth URLs and callback parameters without Telegram Markdown mangling.
    await sendChunks(ctx.chat.id, await action(), false);
  } catch (error) {
    logger.error("Connector command failed", { error: errorMessage(error) });
    await sendChunks(ctx.chat.id, `Connector operation failed: ${errorMessage(error)}`, false);
  }
}

export async function handleConnectorConnect(ctx: BotContext): Promise<void> {
  await replyPlain(ctx, () => startConnectorSession(commandArg(ctx.message?.text)));
}

export async function handleConnectorCallback(ctx: BotContext): Promise<void> {
  await replyPlain(ctx, () => submitConnectorCallback(commandArg(ctx.message?.text)));
}

export async function handleConnectorCancel(ctx: BotContext): Promise<void> {
  const name = commandArg(ctx.message?.text);
  await replyPlain(ctx, () => cancelConnectorSession(name ? { name } : {}));
}

export async function handleConnectorStatus(ctx: BotContext): Promise<void> {
  await replyPlain(ctx, () => getConnectorStatusMessage(commandArg(ctx.message?.text)));
}
