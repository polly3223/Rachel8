import { env } from "../config/env.ts";
import { generateClaudeResponse } from "./claude.ts";
import { generateCodexResponse } from "./codex.ts";
import { KeyedQueue } from "../lib/keyed-queue.ts";
import {
  normalizeConversationKey,
  type ConversationKey,
} from "./conversation.ts";

const chatQueue = new KeyedQueue<string>();

async function generateProviderResponse(
  conversationKey: string,
  userMessage: string,
): Promise<string> {
  switch (env.AI_PROVIDER) {
    case "codex":
      return generateCodexResponse(conversationKey, userMessage);
    case "claudecode":
    default:
      return generateClaudeResponse(conversationKey, userMessage);
  }
}

export async function generateResponse(
  conversationKey: ConversationKey,
  userMessage: string,
): Promise<string> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  return chatQueue.run(normalizedKey, () =>
    generateProviderResponse(normalizedKey, userMessage),
  );
}
