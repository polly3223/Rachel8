import type { BotContext } from "../bot.ts";
import { generateResponse } from "../../ai/claude.ts";
import { logger } from "../../lib/logger.ts";

export async function handleMessage(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  // Trigger typing indicator -- autoChatAction plugin keeps it alive
  ctx.chatAction = "typing";

  try {
    const response = await generateResponse(text);
    await ctx.reply(response);
  } catch (error) {
    logger.error("Failed to generate response", {
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply("Sorry, I encountered an error. Please try again.");
  }
}
