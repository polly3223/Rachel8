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

async function replyWithErrors(ctx: BotContext, action: () => Promise<string>): Promise<void> {
  try {
    await ctx.reply(await action());
  } catch (error) {
    logger.error("Connector command failed", { error: errorMessage(error) });
    await ctx.reply(`Connector operation failed: ${errorMessage(error)}`);
  }
}

export async function handleConnectorConnect(ctx: BotContext): Promise<void> {
  await replyWithErrors(ctx, () => startConnectorSession(commandArg(ctx.message?.text)));
}

export async function handleConnectorCallback(ctx: BotContext): Promise<void> {
  await replyWithErrors(ctx, () => submitConnectorCallback(commandArg(ctx.message?.text)));
}

export async function handleConnectorCancel(ctx: BotContext): Promise<void> {
  await replyWithErrors(ctx, () => cancelConnectorSession());
}

export async function handleConnectorStatus(ctx: BotContext): Promise<void> {
  await replyWithErrors(ctx, () => getConnectorStatusMessage(commandArg(ctx.message?.text)));
}
