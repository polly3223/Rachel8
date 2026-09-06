import { z } from "zod";
import { connectCodex, type RpcClient } from "./rpc.ts";
import { resolveCliPath } from "./cli-path.ts";
import { env } from "../config/env.ts";
import { getReasoningEffort } from "../lib/reasoning-effort.ts";
import { LINEAR_APP_ID } from "../lib/connector-config.ts";
import type { Input, TurnOptions } from "./turn.ts";
import type { Output } from "../lib/work-store.ts";
import { persistArtifact, toolDefinitions } from "../lib/capabilities.ts";

const eventSchema = z.object({
  threadId: z.string().optional(),
  turnId: z.string().optional(),
  tokenUsage: z.unknown().optional(),
  turn: z
    .object({
      id: z.string(),
      status: z.string(),
      error: z.object({ message: z.string() }).nullish(),
    })
    .optional(),
  item: z
    .object({
      id: z.string(),
      type: z.string(),
      text: z.string().optional(),
      phase: z.string().nullish(),
      savedPath: z.string().nullish(),
      result: z.unknown().optional(),
      status: z.string().optional(),
      questions: z
        .array(z.object({ title: z.string(), options: z.array(z.string()).nullish() }))
        .nullish(),
    })
    .optional(),
});
function inputItems(input: Input) {
  return [
    { type: "text", text: input.text },
    ...(input.images ?? []).map((path) => ({ type: "localImage", path })),
  ];
}

export async function runCodex(options: TurnOptions, connection?: RpcClient): Promise<Output> {
  options.signal.throwIfAborted();
  const client = connection ?? (await connectCodex(await resolveCliPath("codex"), options.signal));
  let threadId = "",
    turnId = "",
    final = "";
  const artifacts: string[] = [];
  let sideEffects = Promise.resolve();
  let complete!: () => void, fail!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  void done.catch(() => {});
  const abort = () => {
    if (threadId && turnId)
      void client
        .call("turn/interrupt", { threadId, turnId }, 5000)
        .catch(() => {})
        .finally(() => client.close());
    else client.close();
    fail(new DOMException("Stopped", "AbortError"));
  };
  options.signal.addEventListener("abort", abort, { once: true });
  client.onEvent = (method, raw) => {
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.threadId && event.threadId !== threadId) return;
    if (method === "turn/started" && event.turn) turnId = event.turn.id;
    if (method === "thread/tokenUsage/updated") options.onActivity?.("Working", event.tokenUsage);
    if (method === "turn/completed" && event.turn) {
      if (event.turn.status === "completed") complete();
      else
        fail(
          event.turn.status === "interrupted"
            ? new DOMException("Stopped", "AbortError")
            : new Error(event.turn.error?.message ?? "Codex turn failed"),
        );
    }
    const item = event.item;
    if (!item) return;
    if (method === "item/started") {
      const activities: Record<string, string> = {
        commandExecution: "Running a command",
        fileChange: "Editing files",
        webSearch: "Searching the web",
        mcpToolCall: "Using a connector",
        imageGeneration: "Generating an image",
        contextCompaction: "Saving conversation context",
      };
      const activity = activities[item.type];
      if (activity) options.onActivity?.(activity);
    }
    if (method !== "item/completed") return;
    if (item.type === "agentMessage" && item.text) {
      if (item.phase === "commentary" || item.questions?.length) {
        const text = item.questions?.length
          ? item.questions
              .map((q) => `${q.title}\n${(q.options ?? []).map((o) => `- ${o}`).join("\n")}`)
              .join("\n\n")
          : item.text;
        sideEffects = sideEffects.then(async () => {
          await options.onProgress?.(text);
        });
      } else final = item.text;
    }
    if (item.type === "imageGeneration" && item.status === "completed") {
      sideEffects = sideEffects.then(async () => {
        const path = await persistArtifact(
          item.savedPath ?? undefined,
          typeof item.result === "string" ? item.result : undefined,
        );
        if (path) artifacts.push(path);
      });
    }
    void sideEffects.catch(fail);
  };
  client.onRequest = async (method, raw) => {
    if (method === "item/tool/call") {
      const request = z
        .object({ tool: z.string(), arguments: z.unknown(), threadId: z.string() })
        .parse(raw);
      if (request.threadId !== threadId || !options.tool)
        throw new Error("Tool unavailable for this conversation");
      try {
        return {
          success: true,
          contentItems: [
            {
              type: "inputText",
              text: JSON.stringify(await options.tool(request.tool, request.arguments)),
            },
          ],
        };
      } catch (error) {
        return { success: false, contentItems: [{ type: "inputText", text: String(error) }] };
      }
    }
    if (method === "item/tool/requestUserInput" || method === "tool/requestUserInput") {
      const request = z
        .object({
          threadId: z.string(),
          questions: z.array(
            z.object({
              id: z.string(),
              question: z.string(),
              options: z.array(z.object({ label: z.string() })).nullish(),
            }),
          ),
        })
        .parse(raw);
      if (request.threadId !== threadId || !options.ask)
        throw new Error("Interactive input is unavailable here");
      const answers: Record<string, { answers: string[] }> = {};
      for (const question of request.questions)
        answers[question.id] = {
          answers: [
            await options.ask(question.question, question.options?.map((o) => o.label) ?? []),
          ],
        };
      return { answers };
    }
    throw new Error(`Unsupported interactive request: ${method}`);
  };
  try {
    const common = {
      cwd: process.cwd(),
      model: env.CODEX_MODEL ?? "gpt-6-astra",
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      developerInstructions: options.instructions,
      config: { apps: { [LINEAR_APP_ID]: { enabled: false } }, web_search: "live" },
    };
    const response = await client.call<{ thread: { id: string } }>(
      options.sessionId ? "thread/resume" : "thread/start",
      {
        ...common,
        ...(options.sessionId
          ? { threadId: options.sessionId, excludeTurns: true }
          : { dynamicTools: toolDefinitions }),
      },
    );
    threadId = response.thread.id;
    options.onSession(threadId);
    options.signal.throwIfAborted();
    const turn = await client.call<{ turn: { id: string } }>("turn/start", {
      threadId,
      input: inputItems(options.input),
      effort: await getReasoningEffort(env.SHARED_FOLDER_PATH, Bun.env["CODEX_REASONING_EFFORT"]),
    });
    turnId = turn.turn.id;
    options.onControl?.(async (input) => {
      await client.call("turn/steer", {
        threadId,
        expectedTurnId: turnId,
        input: inputItems(input),
      });
    });
    await Promise.race([done, client.closed]);
    await sideEffects;
    return { text: final.trim(), artifacts };
  } finally {
    options.signal.removeEventListener("abort", abort);
    client.close();
  }
}

export async function codexCapabilities(): Promise<unknown> {
  const client = await connectCodex(await resolveCliPath("codex"));
  try {
    const servers: unknown[] = [];
    let cursor: string | null = null;
    do {
      const page: {
        data: { name: string; authStatus: string; tools: Record<string, unknown> }[];
        nextCursor: string | null;
      } = await client.call("mcpServerStatus/list", {
        cursor,
        limit: 100,
        detail: "toolsAndAuthOnly",
      });
      servers.push(
        ...page.data.map((s) => ({
          name: s.name,
          auth: s.authStatus,
          tools: Object.keys(s.tools).length,
        })),
      );
      cursor = page.nextCursor;
    } while (cursor);
    return servers;
  } finally {
    client.close();
  }
}
