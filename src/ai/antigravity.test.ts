import { expect, test } from "bun:test";
import { resolveAntigravityModel, runAntigravity } from "./antigravity.ts";
import { RpcClient } from "./rpc.ts";
import type { Input } from "./turn.ts";

const initialized = {
  agentCapabilities: { _meta: { antigravity: { systemPrompt: { append: true } } } },
};

test("ACP resumes without resending systemPrompt, selects XHigh, and separates progress from final text", async () => {
  const methods: string[] = [],
    progress: string[] = [];
  const id = "retained";
  const client = new RpcClient((packet) => {
    const method = packet.method!;
    methods.push(method);
    if (method === "session/resume") {
      const params = packet.params as {
        sessionId: string;
        _meta?: { antigravity?: { systemPrompt?: unknown; eagerMcpServers?: string[] } };
      };
      expect(params.sessionId).toBe(id);
      expect(params._meta?.antigravity?.systemPrompt).toBeUndefined();
      expect(params._meta?.antigravity?.eagerMcpServers).toEqual(["rachel"]);
    }
    if (method === "session/set_model")
      expect(packet.params).toMatchObject({ modelId: "gemini-4-neon-xhigh" });
    function update(sessionUpdate: string, content?: unknown, sessionId = id) {
      client.accept({
        method: "session/update",
        params: { sessionId, update: { sessionUpdate, content } },
      });
    }
    if (method === "session/prompt") {
      update("agent_thought_chunk", { type: "text", text: "private thoughts" });
      update("agent_message_chunk", { type: "text", text: "unrelated session" }, "other");
      update("agent_message_chunk", { type: "text", text: "Checking" });
      update("tool_call");
      update("tool_call_update", [{ type: "text", text: "private result" }]);
      update("agent_message_chunk", { type: "text", text: "Done" });
    }
    client.accept({
      id: packet.id,
      result: method === "initialize" ? initialized : { stopReason: "end_turn" },
    });
  });
  const result = await runAntigravity(
    {
      input: { text: "test" },
      instructions: "current instructions",
      sessionId: id,
      signal: new AbortController().signal,
      onSession: (saved) => expect(saved).toBe(id),
      onProgress: async (message) => {
        progress.push(message);
      },
    },
    client,
  );
  expect(methods).toEqual(["initialize", "session/resume", "session/set_model", "session/prompt"]);
  expect(progress).toEqual(["Checking"]);
  expect(result.text).toBe("Done");
});

test("session/new sends systemPrompt.append and clears pre-tool commentary even without onProgress", async () => {
  let newParams: unknown;
  const id = "fresh-session";
  const client = new RpcClient((packet) => {
    if (packet.method === "session/new") newParams = packet.params;
    if (packet.method === "session/prompt") {
      client.accept({
        method: "session/update",
        params: {
          sessionId: id,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Checking monitor..." } },
        },
      });
      client.accept({
        method: "session/update",
        params: { sessionId: id, update: { sessionUpdate: "tool_call", kind: "execute" } },
      });
      client.accept({
        method: "session/update",
        params: {
          sessionId: id,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "No response needed." } },
        },
      });
    }
    client.accept({
      id: packet.id,
      result:
        packet.method === "initialize"
          ? initialized
          : packet.method === "session/new"
            ? { sessionId: id }
            : { stopReason: "end_turn" },
    });
  });
  const result = await runAntigravity(
    {
      input: { text: "run check" },
      instructions: "static instructions",
      signal: new AbortController().signal,
      onSession: () => {},
    },
    client,
  );
  expect(newParams).toMatchObject({
    _meta: {
      antigravity: {
        systemPrompt: { append: "static instructions" },
        eagerMcpServers: ["rachel"],
      },
    },
  });
  expect(result.text).toBe("No response needed.");
});

test("live ACP steering hands off the turn and rejects late steers after completion", async () => {
  let steer!: (input: Input) => Promise<void>;
  const promptIds: number[] = [];
  const progress: string[] = [];
  const id = "steered-session";
  const client = new RpcClient((packet) => {
    if (packet.method === "session/prompt") {
      const reqId = packet.id as number;
      promptIds.push(reqId);
      if (promptIds.length === 1) {
        client.accept({
          method: "session/update",
          params: {
            sessionId: id,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Working on step 1" } },
          },
        });
      } else {
        // ACP resolves the previous prompt immediately on handoff, then finishes the steered prompt.
        client.accept({ id: promptIds[0], result: { stopReason: "end_turn" } });
        queueMicrotask(() => {
          client.accept({
            method: "session/update",
            params: {
              sessionId: id,
              update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Steered final answer" } },
            },
          });
          client.accept({ id: reqId, result: { stopReason: "end_turn" } });
        });
      }
      return;
    }
    client.accept({
      id: packet.id,
      result:
        packet.method === "initialize"
          ? initialized
          : packet.method === "session/new"
            ? { sessionId: id }
            : { stopReason: "end_turn" },
    });
  });
  const task = runAntigravity(
    {
      input: { text: "initial" },
      instructions: "static",
      signal: new AbortController().signal,
      onSession: () => {},
      onProgress: async (msg) => {
        progress.push(msg);
      },
      onControl: (fn) => {
        steer = fn;
      },
    },
    client,
  );
  await Bun.sleep(10);
  await steer({ text: "change direction" });
  const result = await task;
  expect(promptIds).toHaveLength(2);
  expect(progress).toEqual(["Working on step 1"]);
  expect(result.text).toBe("Steered final answer");
  await expect(steer({ text: "too late" })).rejects.toThrow("No active turn");
});

test("abort sends session/cancel before closing and throws AbortError", async () => {
  const controller = new AbortController();
  const methods: string[] = [];
  let promptPacketId: number | undefined;
  const id = "cancel-session";
  const client = new RpcClient((packet) => {
    if (packet.method) methods.push(packet.method);
    if (packet.method === "session/prompt") {
      promptPacketId = packet.id as number;
      return;
    }
    if (packet.method === "session/cancel") {
      expect(packet.params).toEqual({ sessionId: id });
      client.accept({ id: promptPacketId, result: { stopReason: "cancelled" } });
      return;
    }
    client.accept({
      id: packet.id,
      result:
        packet.method === "initialize"
          ? initialized
          : packet.method === "session/new"
            ? { sessionId: id }
            : {},
    });
  });
  const task = runAntigravity(
    {
      input: { text: "long task" },
      instructions: "static",
      signal: controller.signal,
      onSession: () => {},
    },
    client,
  );
  await Bun.sleep(10);
  controller.abort();
  await expect(task).rejects.toThrow("Stopped");
  expect(methods).toContain("session/cancel");
});

test("resolveAntigravityModel supports default Neon, base families, and fixed-effort slugs", () => {
  expect(resolveAntigravityModel("xhigh", "")).toBe("gemini-4-neon-xhigh");
  expect(resolveAntigravityModel("medium", "gemini-4-hydrogen")).toBe("gemini-4-hydrogen-medium");
  expect(resolveAntigravityModel("xhigh", "gemini-4-hydrogen-low")).toBe("gemini-4-hydrogen-low");
  expect(resolveAntigravityModel("xhigh", "gemini-pro-orchestrator-neon")).toBe(
    "gemini-pro-orchestrator-neon",
  );
});

test("model selection failure never submits a prompt to a fallback model", async () => {
  const methods: string[] = [];
  const client = new RpcClient((packet) => {
    methods.push(packet.method!);
    if (packet.method === "session/set_model")
      client.accept({ id: packet.id, error: { message: "model unavailable" } });
    else
      client.accept({
        id: packet.id,
        result: packet.method === "initialize" ? initialized : { sessionId: "new" },
      });
  });
  await expect(
    runAntigravity(
      {
        input: { text: "test" },
        instructions: "test",
        signal: new AbortController().signal,
        onSession: () => {},
      },
      client,
    ),
  ).rejects.toThrow("model unavailable");
  expect(methods).toEqual(["initialize", "session/new", "session/set_model"]);
});

test("an older ACP server cannot silently discard Rachel's system instructions", async () => {
  const methods: string[] = [];
  const client = new RpcClient((packet) => {
    methods.push(packet.method!);
    client.accept({ id: packet.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  });
  await expect(
    runAntigravity(
      {
        input: { text: "test" },
        instructions: "private test rules",
        signal: new AbortController().signal,
        onSession: () => {},
      },
      client,
    ),
  ).rejects.toThrow("cannot apply");
  expect(methods).toEqual(["initialize"]);
});
