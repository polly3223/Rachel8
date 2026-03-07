import { env } from "../config/env.ts";
import { generateClaudeResponse } from "./claude.ts";
import { generateCodexResponse } from "./codex.ts";

export async function generateResponse(
  chatId: number,
  userMessage: string,
): Promise<string> {
  switch (env.AI_PROVIDER) {
    case "codex":
      return generateCodexResponse(chatId, userMessage);
    case "claudecode":
    default:
      return generateClaudeResponse(chatId, userMessage);
  }
}
