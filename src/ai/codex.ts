import { Codex, type ThreadOptions } from "@openai/codex-sdk";
import { logger } from "../lib/logger.ts";
import { errorMessage } from "../lib/errors.ts";
import { appendToDailyLog, buildSystemPromptWithMemory } from "../lib/memory.ts";
import { BASE_SYSTEM_PROMPT } from "./prompt.ts";
import { loadSessionMap, saveSessionMap } from "./session-store.ts";

const MODEL = "gpt5.4";

const codex = new Codex();

const threadOptions: ThreadOptions = {
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
  const thread = threadId
    ? codex.resumeThread(threadId, threadOptions)
    : codex.startThread(threadOptions);

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
    const msg = errorMessage(error).toLowerCase();
    const isThreadGone =
      msg.includes("resume") ||
      msg.includes("thread") ||
      msg.includes("session") ||
      msg.includes("not found");
    const isContextOverflow =
      msg.includes("context") ||
      msg.includes("too many tokens") ||
      msg.includes("prompt is too long") ||
      msg.includes("request too large");

    if ((isContextOverflow || isThreadGone) && existingThreadId) {
      logger.warn(
        `Codex thread ${existingThreadId} is no longer usable for chat ${chatId}, starting fresh thread`,
      );

      sessions.delete(chatId);
      await saveSessionMap("codex", sessions);

      const { result, threadId } = await runTurn(userMessage, systemPrompt);
      sessions.set(chatId, threadId);
      await saveSessionMap("codex", sessions);
      const freshNotice =
        "[Previous Codex thread was unusable — started a fresh thread. Memory files are still intact.]\n\n" +
        result;
      await appendToDailyLog("assistant", freshNotice);
      return freshNotice;
    }

    throw error;
  }
}
