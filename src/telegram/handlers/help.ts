import type { BotContext } from "../bot.ts";
import { env } from "../../config/env.ts";
import { buildHelpText } from "../commands.ts";

export async function handleHelp(ctx: BotContext): Promise<void> {
  await ctx.reply(buildHelpText(env.AI_PROVIDER));
}
