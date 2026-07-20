import type { BotContext } from "../bot.ts";
import { env } from "../../config/env.ts";
import {
  getReasoningEffort,
  parseReasoningEffort,
  REASONING_EFFORTS,
  setReasoningEffort,
  type ReasoningEffort,
} from "../../lib/reasoning-effort.ts";

export async function handleSetEffort(
  ctx: BotContext,
  effort: ReasoningEffort,
): Promise<void> {
  await setReasoningEffort(env.SHARED_FOLDER_PATH, effort);
  await ctx.reply(`Thinking effort set to ${effort}. It will apply from the next turn.`);
}

export async function handleEffort(ctx: BotContext): Promise<void> {
  const requested = typeof ctx.match === "string" ? ctx.match.trim() : "";
  if (!requested) {
    const current = await getReasoningEffort(
      env.SHARED_FOLDER_PATH,
      Bun.env["CODEX_REASONING_EFFORT"],
    );
    await ctx.reply(`Current thinking effort: ${current}`);
    return;
  }

  const effort = parseReasoningEffort(requested);
  if (!effort) {
    await ctx.reply(`Choose one of: ${REASONING_EFFORTS.join(", ")}`);
    return;
  }

  await handleSetEffort(ctx, effort);
}
