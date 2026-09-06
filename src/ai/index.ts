import { env } from "../config/env.ts";
import { runClaude } from "./claude.ts";
import { runCodex } from "./codex.ts";
import { getStore } from "./session-store.ts";
import { KeyedQueue } from "../lib/keyed-queue.ts";
import { normalizeConversationKey, type ConversationKey } from "./conversation.ts";
import {
  buildContextBootstrapPrompt,
  buildContextHandoffPrompt,
  CONTEXT_REFRESH_READY,
  createContextHandoffPath,
  getContextRefreshSkillPath,
  validateContextHandoff,
} from "../lib/context-refresh.ts";
import { appendToDailyLog, buildSystemPromptWithMemory, redactSecrets } from "../lib/memory.ts";
import { BASE_SYSTEM_PROMPT } from "./prompt.ts";
import { assertProviderAuthenticated, isProviderAuthFailure, ProviderAuthError } from "./auth.ts";
import { isContextOverflowError, isCodexThreadUnavailableError } from "./session-errors.ts";
import type { Input } from "./turn.ts";
import type { Output } from "../lib/work-store.ts";
import { executeCapability } from "../lib/capabilities.ts";

const queue = new KeyedQueue<string>();
interface Control {
  abort: AbortController;
  steer?: (input: Input) => Promise<void>;
  answer?: (value: string) => void;
}
const active = new Map<string, Control>();
export interface GenerateOptions {
  runId?: number;
  signal?: AbortSignal;
  controlKey?: string;
  onProgress?: (text: string) => Promise<void>;
  onQuestion?: (text: string, options: string[]) => Promise<void>;
}
const provider = env.AI_PROVIDER === "codex" ? "codex" : "claude";

export function answerConversation(key: ConversationKey, text: string): boolean {
  const control = active.get(String(key));
  if (!control?.answer) return false;
  control.answer(text);
  return true;
}
export async function steerConversation(key: ConversationKey, input: Input): Promise<boolean> {
  const control = active.get(String(key));
  if (!control?.steer || control.abort.signal.aborted) return false;
  await control.steer(input);
  await appendToDailyLog("user", input.text, String(key));
  return true;
}
export function shutdownAI(): void {
  for (const control of active.values()) control.abort.abort();
}

async function run(
  key: string,
  input: Input,
  options: GenerateOptions = {},
  sessionOverride?: string | null,
): Promise<Output> {
  const store = getStore();
  const control: Control = { abort: new AbortController() };
  const abort = () => control.abort.abort();
  options.signal?.throwIfAborted();
  options.signal?.addEventListener("abort", abort, { once: true });
  const controlKey = options.controlKey ?? key;
  active.set(controlKey, control);
  const sessionId =
    sessionOverride === null ? undefined : (sessionOverride ?? store.session(provider, key));
  try {
    const instructions = await buildSystemPromptWithMemory(
      `${BASE_SYSTEM_PROMPT}\nCurrent work ID: ${options.runId ?? "interactive"}; conversation: ${key}.`,
      key,
      input.text,
    );
    await assertProviderAuthenticated(env.AI_PROVIDER);
    const onSession = (id: string) => store.saveSession(provider, key, id);
    const turn = env.AI_PROVIDER === "codex" ? runCodex : runClaude;
    const turnOptions = {
      input,
      instructions,
      sessionId,
      signal: control.abort.signal,
      onSession,
      onProgress: options.onProgress,
      onActivity: (text: string, usage?: unknown) => {
        if (options.runId) store.progress(options.runId, text, usage);
      },
      onControl: (steer: (input: Input) => Promise<void>) => {
        control.steer = steer;
      },
      tool: (name: string, args: unknown) => executeCapability(name, args, options.runId),
      ask: async (question: string, choices: string[]) => {
        if (!options.onQuestion)
          throw new Error("No interactive recipient; return the question in your report");
        control.abort.signal.throwIfAborted();
        const answer = new Promise<string>((resolve, reject) => {
          const cancel = () => {
            control.answer = undefined;
            reject(new DOMException("Stopped", "AbortError"));
          };
          control.abort.signal.addEventListener("abort", cancel, { once: true });
          control.answer = (value) => {
            control.abort.signal.removeEventListener("abort", cancel);
            control.answer = undefined;
            resolve(value);
          };
        });
        void answer.catch(() => {});
        await options.onQuestion(question, choices);
        return answer;
      },
    };
    try {
      return await turn(turnOptions);
    } catch (error) {
      if (control.abort.signal.aborted) throw new DOMException("Stopped", "AbortError");
      if (isProviderAuthFailure(env.AI_PROVIDER, error))
        throw new ProviderAuthError(env.AI_PROVIDER);
      const text = String(error);
      if (
        !sessionId ||
        !(
          isContextOverflowError(text) ||
          isCodexThreadUnavailableError(text) ||
          /no conversation found|session not found/i.test(text)
        )
      )
        throw error;
      // No retry for capacity, tool failures or uncertain side effects. Only an unusable session.
      const checkpoint = options.runId ? store.get(options.runId)?.checkpoint : null;
      return turn({
        ...turnOptions,
        sessionId: undefined,
        input: {
          ...input,
          text: `The previous thread (${sessionId}) could not continue. Its tools may already have completed actions. Read the current project files and saved receipts before continuing; do not repeat completed sends or deployments.\n${checkpoint ? `Saved active-work checkpoint (context only):\n${checkpoint}\n\n` : ""}${input.text}`,
        },
      });
    }
  } finally {
    active.delete(controlKey);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function generate(
  conversationKey: ConversationKey,
  input: Input,
  options: GenerateOptions = {},
): Promise<Output> {
  const key = normalizeConversationKey(conversationKey);
  return queue.run(key, async () => {
    options.signal?.throwIfAborted();
    await appendToDailyLog("user", input.text, key, options.runId);
    if (options.runId)
      getStore().db.run("UPDATE runs SET checkpoint=? WHERE id=?", [
        redactSecrets(input.text),
        options.runId,
      ]);
    const result = await run(key, input, options);
    await appendToDailyLog("assistant", result.text, key, options.runId);
    return result;
  });
}
export async function generateResponse(key: ConversationKey, text: string): Promise<string> {
  return (await generate(key, { text })).text;
}

export async function refreshConversationContext(
  conversationKey: ConversationKey,
  options: GenerateOptions = {},
): Promise<string> {
  const key = normalizeConversationKey(conversationKey);
  return queue.run(key, async () => {
    const handoff = await createContextHandoffPath(env.SHARED_FOLDER_PATH, key);
    await run(
      key,
      { text: buildContextHandoffPrompt(getContextRefreshSkillPath(), handoff) },
      options,
    );
    await validateContextHandoff(handoff);
    // Stage the fresh thread under a temporary key. Commit only after bootstrap succeeds.
    const staged = `${key}:refresh:${crypto.randomUUID()}`;
    try {
      const result = await run(
        staged,
        { text: buildContextBootstrapPrompt(handoff) },
        { ...options, controlKey: key },
        null,
      );
      options.signal?.throwIfAborted();
      if (!result.text.includes(CONTEXT_REFRESH_READY))
        throw new Error("Fresh thread did not confirm the handoff");
      const id = getStore().session(provider, staged);
      if (!id) throw new Error("Fresh thread was not saved");
      getStore().saveSession(provider, key, id);
      return handoff;
    } finally {
      getStore().db.run("DELETE FROM sessions WHERE provider=? AND key=?", [provider, staged]);
    }
  });
}
