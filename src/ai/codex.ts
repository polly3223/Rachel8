import { Codex, type ThreadOptions } from "@openai/codex-sdk";
import { logger } from "../lib/logger.ts";
import { errorMessage } from "../lib/errors.ts";
import { appendToDailyLog, buildSystemPromptWithMemory } from "../lib/memory.ts";
import { BASE_SYSTEM_PROMPT } from "./prompt.ts";
import { loadSessionMap, saveSessionMap } from "./session-store.ts";
import { assertProviderAuthenticated, isProviderAuthFailure, ProviderAuthError } from "./auth.ts";
import { env } from "../config/env.ts";
import { LINEAR_APP_ID } from "../lib/connector-config.ts";
import {
  isCodexThreadUnavailableError,
  isContextOverflowError,
} from "./session-errors.ts";
import {
  getReasoningEffort,
  type ReasoningEffort,
} from "../lib/reasoning-effort.ts";

const MODEL = env.CODEX_MODEL || "gpt-5.6-sol";

function createCodex(reasoningEffort: ReasoningEffort): Codex {
  return new Codex({
    config: {
      model_reasoning_effort: reasoningEffort,
      // Linear's local MCP uses Telegram-managed OAuth. Disable only the stale
      // ChatGPT app path so Codex cannot select it ahead of the local server.
      apps: {
        [LINEAR_APP_ID]: { enabled: false },
      },
    },
  });
}

const baseThreadOptions: ThreadOptions = {
  sandboxMode: "danger-full-access",
  approvalPolicy: "never",
  workingDirectory: process.cwd(),
  skipGitRepoCheck: true,
  networkAccessEnabled: true,
  webSearchEnabled: true,
  additionalDirectories: [process.cwd(), Bun.env["SHARED_FOLDER_PATH"]].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  ),
  ...(MODEL ? { model: MODEL } : {}),
};

const sessions = await loadSessionMap("codex");

function buildCodexPrompt(systemPrompt: string, userMessage: string): string {
  return [
    "Follow the operating instructions below for this turn.",
    "",
    "<system_instructions>",
    systemPrompt,
    "</system_instructions>",
    "",
    "<user_message>",
    userMessage,
    "</user_message>",
  ].join("\n");
}

async function runTurn(
  userMessage: string,
  systemPrompt: string,
  threadId?: string,
): Promise<{ result: string; threadId: string }> {
  const reasoningEffort = await getReasoningEffort(
    env.SHARED_FOLDER_PATH,
    Bun.env["CODEX_REASONING_EFFORT"],
  );
  const codex = createCodex(reasoningEffort);
  const thread = threadId
    ? codex.resumeThread(threadId, baseThreadOptions)
    : codex.startThread(baseThreadOptions);

  const turn = await thread.run(buildCodexPrompt(systemPrompt, userMessage));
  const currentThreadId = thread.id;

  if (!currentThreadId) {
    throw new Error("Codex did not return a thread id");
  }

  return {
    result: turn.finalResponse.trim() || "No response requested.",
    threadId: currentThreadId,
  };
}

export async function generateCodexResponse(
  chatId: number,
  userMessage: string,
): Promise<string> {
  const existingThreadId = sessions.get(chatId);

  await assertProviderAuthenticated("codex");

  await appendToDailyLog("user", userMessage);
  const systemPrompt = await buildSystemPromptWithMemory(BASE_SYSTEM_PROMPT);

  try {
    const { result, threadId } = await runTurn(
      userMessage,
      systemPrompt,
      existingThreadId,
    );
    sessions.set(chatId, threadId);
    await saveSessionMap("codex", sessions);
    await appendToDailyLog("assistant", result);
    return result;
  } catch (error) {
    const message = errorMessage(error);
    const isThreadGone = isCodexThreadUnavailableError(message);
    const isContextOverflow = isContextOverflowError(message);

    if ((isContextOverflow || isThreadGone) && existingThreadId) {
      logger.warn(
        `Codex thread ${existingThreadId} is no longer usable for chat ${chatId}, starting fresh thread`,
      );

      sessions.delete(chatId);
      await saveSessionMap("codex", sessions);

      try {
        const { result, threadId } = await runTurn(userMessage, systemPrompt);
        sessions.set(chatId, threadId);
        await saveSessionMap("codex", sessions);
        const freshNotice =
          "[Previous Codex thread was unusable - started a fresh thread. Memory files are still intact.]\n\n" +
          result;
        await appendToDailyLog("assistant", freshNotice);
        return freshNotice;
      } catch (retryError) {
        if (isProviderAuthFailure("codex", retryError)) {
          throw new ProviderAuthError("codex");
        }
        throw retryError;
      }
    }

    if (isProviderAuthFailure("codex", error)) {
      throw new ProviderAuthError("codex");
    }

    throw error;
  }
}
