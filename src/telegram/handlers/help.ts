import type { BotContext } from "../bot.ts";
import { buildHelpText } from "../commands.ts";

export async function handleHelp(ctx: BotContext): Promise<void> {
  await ctx.reply(buildHelpText());
}
