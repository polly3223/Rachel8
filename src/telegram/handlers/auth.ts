import type { BotContext } from "../bot.ts";
import { startLoginSession, submitLoginCode, cancelLoginSession, getLoginStatusMessage } from "../../lib/login-session.ts";

function commandArg(ctx: BotContext): string | undefined {
  const text = ctx.message?.text ?? "";
  const parts = text.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : undefined;
}

export async function handleLogin(ctx: BotContext): Promise<void> {
  const arg = commandArg(ctx);
  const message = await startLoginSession(arg);
  await ctx.reply(message);
}

export async function handleLoginCode(ctx: BotContext): Promise<void> {
  const code = commandArg(ctx);
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
  const arg = commandArg(ctx);
  const message = await getLoginStatusMessage(arg);
  await ctx.reply(message);
}
