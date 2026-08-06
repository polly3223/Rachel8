import type { BotContext } from "../bot.ts";
import { refreshConversationContext } from "../../ai/index.ts";
import { logger } from "../../lib/logger.ts";
import { errorMessage } from "../../lib/errors.ts";
import { ProviderAuthError } from "../../ai/auth.ts";

export async function handleContextRefresh(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;

  ctx.chatAction = "typing";
  await ctx.reply("Saving the active context and preparing a fresh thread…");

  try {
    await refreshConversationContext(chatId);
    await ctx.reply("Fresh context loaded — ready and light again.");
  } catch (error) {
    if (error instanceof ProviderAuthError) {
      await ctx.reply(error.message);
      return;
    }
    logger.error("Failed to refresh conversation context", {
      chatId,
      error: errorMessage(error),
    });
    await ctx.reply(
      "I couldn't complete the refresh. No memory files were deleted; any completed handoff remains saved. Please try again.",
    );
  }
}
