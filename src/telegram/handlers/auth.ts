import type { BotContext } from "../bot.ts";
import { startLoginSession, submitLoginCode, cancelLoginSession, getLoginStatusMessage } from "../../lib/login-session.ts";
import { commandArg } from "../../lib/command.ts";

export async function handleLogin(ctx: BotContext): Promise<void> {
  const arg = commandArg(ctx.message?.text);
  const message = await startLoginSession(arg);
  await ctx.reply(message);
}

export async function handleLoginCode(ctx: BotContext): Promise<void> {
  const code = commandArg(ctx.message?.text);
  if (!code) {
    await ctx.reply("Usage: /login_code <code>");
    return;
  }

  const message = await submitLoginCode(code);
  await ctx.reply(message);
}

export async function handleLoginCancel(ctx: BotContext): Promise<void> {
  const message = await cancelLoginSession();
  await ctx.reply(message);
}

export async function handleLoginStatus(ctx: BotContext): Promise<void> {
  const arg = commandArg(ctx.message?.text);
  const message = await getLoginStatusMessage(arg);
  await ctx.reply(message);
}
