import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { env } from "../config/env.ts";
import { toolDefinitions } from "../lib/capabilities.ts";
import { getReasoningEffort, type ReasoningEffort } from "../lib/reasoning-effort.ts";
import { resolveCliPath } from "./cli-path.ts";
import { connectStdio, type RpcClient } from "./rpc.ts";
import type { Input, TurnOptions } from "./turn.ts";

export class AntigravitySessionUnavailable extends Error {}

export function resolveAntigravityModel(
  effort: ReasoningEffort,
  configured = Bun.env["ANTIGRAVITY_MODEL"]?.trim(),
): string {
  if (!configured) return `gemini-4-neon-${effort}`;
  if (/(?:-(?:low|medium|high|xhigh)|orchestrator)/.test(configured)) return configured;
  return `${configured}-${effort}`;
}

function startToolBridge(tool: NonNullable<TurnOptions["tool"]>) {
  const dir = mkdtempSync(join(tmpdir(), "rachel-acp-"));
  const socket = join(dir, "tools.sock");
  try {
    const server = Bun.serve({
      unix: socket,
      async fetch(req) {
        if (req.method === "GET")
          return Response.json(toolDefinitions.map(({ type, ...definition }) => definition));
        try {
          const call = z
            .object({ name: z.string(), arguments: z.unknown() })
            .parse(await req.json());
          return Response.json(await tool(call.name, call.arguments));
        } catch (error) {
          return new Response(String(error), { status: 400 });
        }
      },
    });
    return {
      config: {
        name: "rachel",
        command: process.execPath,
        args: [join(process.cwd(), "scripts/antigravity-tools.ts"), socket],
        env: [],
      },
      async close() {
        await server.stop(true);
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

async function promptBlocks(input: Input) {
  return [
    { type: "text", text: input.text },
    ...(await Promise.all(
      (input.images ?? []).map(async (path) => {
        const file = Bun.file(path);
        return {
          type: "image",
          mimeType: file.type.split(";")[0]?.trim() || "image/jpeg",
          data: (await file.bytes()).toBase64(),
        };
      }),
    )),
  ];
}

type PromptResult = {
  stopReason: string;
  usage?: { totalTokens?: number };
};

const updateSchema = z.object({
  sessionId: z.string(),
  update: z.object({
    sessionUpdate: z.string(),
    content: z.unknown().optional(),
    kind: z.string().optional(),
  }),
});
const permissionSchema = z.object({
  sessionId: z.string(),
  toolCall: z.object({ title: z.string() }),
  options: z.array(z.object({ optionId: z.string(), kind: z.string() })),
});

export async function runAntigravity(options: TurnOptions, connection?: RpcClient) {
  options.signal.throwIfAborted();
  const client =
    connection ??
    connectStdio(
      "Antigravity",
      await resolveCliPath("antigravity"),
      [
        "acp",
        "--disable-telemetry",
        "--add-dir",
        env.SHARED_FOLDER_PATH,
        ...(Bun.env["ANTIGRAVITY_AUTO_APPROVE_TOOLS"] === "true"
          ? ["--dangerously-skip-permissions"]
          : []),
      ],
    );
  let sessionId: string | undefined;
  let text = "",
    permissionPending = false,
    acceptingSteer = false;
  let progress = Promise.resolve();
  let bridge: ReturnType<typeof startToolBridge> | undefined;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  const flushProgress = () => {
    const message = text.trim();
    text = "";
    if (!message || !options.onProgress) return;
    progress = progress.then(() => options.onProgress!(message));
    void progress.catch(() => {});
  };
  const abort = () => {
    acceptingSteer = false;
    if (sessionId) {
      try {
        client.send({ method: "session/cancel", params: { sessionId } });
      } catch {
        client.close(new DOMException("Stopped", "AbortError"));
        return;
      }
      cancelTimer = setTimeout(
        () => client.close(new DOMException("Stopped", "AbortError")),
        1500,
      );
      cancelTimer.unref?.();
    } else {
      client.close(new DOMException("Stopped", "AbortError"));
    }
  };
  options.signal.addEventListener("abort", abort, { once: true });
  client.onEvent = (method, params) => {
    if (method !== "session/update") return;
    const event = updateSchema.parse(params);
    if (event.sessionId !== sessionId) return;
    const u = event.update;
    if (u.sessionUpdate === "agent_message_chunk") {
      const chunk = z.object({ type: z.literal("text"), text: z.string() }).safeParse(u.content);
      if (chunk.success) text += chunk.data.text;
    }
    if (u.sessionUpdate === "tool_call") {
      options.onActivity?.(`Using tool (${u.kind ?? "other"})`);
      flushProgress();
    }
  };
  client.onRequest = async (method, params) => {
    if (method !== "session/request_permission") throw new Error("Unsupported ACP request");
    const q = permissionSchema.parse(params);
    const once = q.options.find((o) => o.kind === "allow_once");
    if (q.sessionId === sessionId && options.ask && once && !permissionPending) {
      permissionPending = true;
      try {
        if (
          (await options.ask(`Antigravity requests permission: ${q.toolCall.title}`, [
            "Allow once",
            "Deny",
          ])) === "Allow once"
        )
          return { outcome: { outcome: "selected", optionId: once.optionId } };
      } finally {
        permissionPending = false;
      }
    }
    return { outcome: { outcome: "cancelled" } };
  };
  try {
    const info = await client.call<{
      agentCapabilities?: { _meta?: { antigravity?: { systemPrompt?: { append?: boolean } } } };
    }>("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "rachel8", version: "1" },
    });
    if (info.agentCapabilities?._meta?.antigravity?.systemPrompt?.append !== true)
      throw new Error(
        "This Antigravity CLI cannot apply Rachel’s instructions. Update agy and try again.",
      );
    if (options.tool) bridge = startToolBridge(options.tool);
    const base = {
      cwd: process.cwd(),
      mcpServers: bridge ? [bridge.config] : [],
    };
    if (options.sessionId) {
      // Omit systemPrompt on resume: ACP keeps the session/new append and preserves prompt caching.
      try {
        await client.call("session/resume", {
          ...base,
          sessionId: options.sessionId,
          _meta: { antigravity: { eagerMcpServers: ["rachel"] } },
        });
      } catch (error) {
        if (/session not found|conversation not found|trajectory not found/i.test(String(error)))
          throw new AntigravitySessionUnavailable("Antigravity session not found", {
            cause: error,
          });
        throw error;
      }
      sessionId = options.sessionId;
    } else {
      sessionId = z
        .object({ sessionId: z.string().min(1) })
        .parse(
          await client.call("session/new", {
            ...base,
            _meta: {
              antigravity: {
                systemPrompt: { append: options.instructions },
                eagerMcpServers: ["rachel"],
              },
            },
          }),
        ).sessionId;
    }
    const effort = await getReasoningEffort(env.SHARED_FOLDER_PATH, "xhigh", "antigravity");
    await client.call("session/set_model", {
      sessionId,
      modelId: resolveAntigravityModel(effort),
    });
    options.onSession(sessionId);
    const prompt = await promptBlocks(options.input);
    options.signal.throwIfAborted();
    const sendPrompt = (blocks: Awaited<ReturnType<typeof promptBlocks>>) =>
      client.call<PromptResult>("session/prompt", { sessionId, prompt: blocks }, 0);
    let activePrompt = sendPrompt(prompt);
    acceptingSteer = true;
    options.onControl?.(async (steerInput) => {
      if (!acceptingSteer || options.signal.aborted) throw new Error("No active turn");
      const blocks = await promptBlocks(steerInput);
      if (!acceptingSteer || options.signal.aborted) throw new Error("No active turn");
      // Flush pre-steer commentary before sending `next` so chunks from `next` are never cleared.
      flushProgress();
      const previous = activePrompt;
      const next = sendPrompt(blocks);
      void next.catch(() => {});
      activePrompt = next;
      // ACP hands off the turn by resolving `previous` immediately when `next` is accepted.
      await Promise.race([previous, next]);
    });
    let result!: PromptResult;
    while (true) {
      const current = activePrompt;
      result = await current;
      if (activePrompt === current) {
        acceptingSteer = false;
        break;
      }
    }
    if (result.usage) options.onActivity?.("Finishing", { last: result.usage });
    await progress;
    if (options.signal.aborted) throw new DOMException("Stopped", "AbortError");
    if (result.stopReason !== "end_turn")
      throw new Error(`Antigravity stopped: ${result.stopReason}`);
    if (!text.trim()) throw new Error("Antigravity returned no answer");
    return { text: text.trim() };
  } finally {
    acceptingSteer = false;
    clearTimeout(cancelTimer);
    options.signal.removeEventListener("abort", abort);
    client.close();
    await bridge?.close();
  }
}
