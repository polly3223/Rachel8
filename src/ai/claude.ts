import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../lib/logger.ts";
import { errorMessage } from "../lib/errors.ts";
import { appendToDailyLog, buildSystemPromptWithMemory } from "../lib/memory.ts";
import { BASE_SYSTEM_PROMPT } from "./prompt.ts";
import { loadSessionMap, saveSessionMap } from "./session-store.ts";
import { assertProviderAuthenticated, isProviderAuthFailure, ProviderAuthError } from "./auth.ts";
import { isContextOverflowError } from "./session-errors.ts";

// Model can be overridden via env var.
const MODEL = Bun.env["CLAUDE_MODEL"] || "claude-opus-4-6";

const sessions = await loadSessionMap("claude");

async function runQuery(
  userMessage: string,
  systemPrompt: string,
  sessionId?: string,
): Promise<{ result: string; sessionId: string }> {
  const conversation = query({
    prompt: userMessage,
    options: {
      systemPrompt,
      model: MODEL,
      maxTurns: Infinity,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      ...(sessionId ? { resume: sessionId } : {}),
    },
  });

  for await (const message of conversation) {
    if (message.type === "result") {
      if (message.subtype === "success") {
        return { result: message.result, sessionId: message.session_id };
      }
      const errors = "errors" in message ? message.errors : [];
      throw new Error(
        (errors as string[])?.join(", ") ?? "Unknown error from Claude",
      );
    }
  }

  throw new Error("No result received from Claude");
}

export async function generateClaudeResponse(
  conversationKey: string,
  userMessage: string,
): Promise<string> {
  const existingSessionId = sessions.get(conversationKey);

  await assertProviderAuthenticated("claudecode");

  // Log user message to daily log
  await appendToDailyLog("user", userMessage);

  // Build system prompt with memory context
  const systemPrompt = await buildSystemPromptWithMemory(BASE_SYSTEM_PROMPT);

  try {
    const { result, sessionId } = await runQuery(
      userMessage,
      systemPrompt,
      existingSessionId,
    );
    sessions.set(conversationKey, sessionId);
    await saveSessionMap("claude", sessions);
    await appendToDailyLog("assistant", result);
    return result;
  } catch (error) {
    const msg = errorMessage(error).toLowerCase();
    const isSessionGone =
      msg.includes("no conversation found") ||
      msg.includes("session not found") ||
      msg.includes("session id");
    const isContextOverflow =
      isContextOverflowError(msg) || msg.includes("max_tokens");

    if ((isContextOverflow || isSessionGone) && existingSessionId) {
      logger.warn(
        `Session ${existingSessionId} context overflow for conversation ${conversationKey}, starting fresh session`,
      );

      // Clear the old session and retry with a fresh one
      sessions.delete(conversationKey);
      await saveSessionMap("claude", sessions);

      try {
        const { result, sessionId } = await runQuery(
          userMessage,
          systemPrompt,
        );
        sessions.set(conversationKey, sessionId);
        await saveSessionMap("claude", sessions);
        const freshNotice =
          "[Context was too large - started fresh session. My memory files are intact so I still know everything important.]\n\n" +
          result;
        await appendToDailyLog("assistant", freshNotice);
        return freshNotice;
      } catch (retryError) {
        if (isProviderAuthFailure("claudecode", retryError)) {
          throw new ProviderAuthError("claudecode");
        }
        logger.error("Failed even with fresh session", {
          error: errorMessage(retryError),
        });
        throw retryError;
      }
    }

    if (isProviderAuthFailure("claudecode", error)) {
      throw new ProviderAuthError("claudecode");
    }

    throw error;
  }
}
