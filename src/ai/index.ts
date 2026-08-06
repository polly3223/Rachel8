import { env } from "../config/env.ts";
import {
  generateClaudeResponse,
  resetClaudeConversation,
} from "./claude.ts";
import {
  generateCodexResponse,
  resetCodexConversation,
} from "./codex.ts";
import { KeyedQueue } from "../lib/keyed-queue.ts";
import {
  normalizeConversationKey,
  type ConversationKey,
} from "./conversation.ts";
import {
  buildContextBootstrapPrompt,
  buildContextHandoffPrompt,
  CONTEXT_HANDOFF_READY,
  CONTEXT_REFRESH_READY,
  createContextHandoffPath,
  getContextRefreshSkillPath,
  validateContextHandoff,
} from "../lib/context-refresh.ts";
import { logger } from "../lib/logger.ts";

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

async function resetProviderConversation(conversationKey: string): Promise<void> {
  switch (env.AI_PROVIDER) {
    case "codex":
      await resetCodexConversation(conversationKey);
      return;
    case "claudecode":
    default:
      await resetClaudeConversation(conversationKey);
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

export async function refreshConversationContext(
  conversationKey: ConversationKey,
): Promise<string> {
  const normalizedKey = normalizeConversationKey(conversationKey);

  return chatQueue.run(normalizedKey, async () => {
    const handoffPath = await createContextHandoffPath(
      env.SHARED_FOLDER_PATH,
      normalizedKey,
    );
    const handoffResponse = await generateProviderResponse(
      normalizedKey,
      buildContextHandoffPrompt(getContextRefreshSkillPath(), handoffPath),
    );

    if (!handoffResponse.includes(CONTEXT_HANDOFF_READY)) {
      logger.warn("Context handoff response did not include readiness marker", {
        conversationKey: normalizedKey,
      });
    }
    await validateContextHandoff(handoffPath);

    await resetProviderConversation(normalizedKey);

    const bootstrapResponse = await generateProviderResponse(
      normalizedKey,
      buildContextBootstrapPrompt(handoffPath),
    );
    if (!bootstrapResponse.includes(CONTEXT_REFRESH_READY)) {
      logger.warn("Fresh context response did not include readiness marker", {
        conversationKey: normalizedKey,
      });
    }

    logger.info("Conversation context refreshed", {
      conversationKey: normalizedKey,
      handoffPath,
    });
    return handoffPath;
  });
}
