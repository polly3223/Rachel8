import { expect, test } from "bun:test";
import { runAntigravity } from "./antigravity.ts";
import { RpcClient } from "./rpc.ts";

const initialized = {
  agentCapabilities: { _meta: { antigravity: { systemPrompt: { append: true } } } },
};

test("ACP restores context before selecting XHigh and only delivers current assistant text", async () => {
  const methods: string[] = [],
    progress: string[] = [];
  const id = "retained";
  const client = new RpcClient((packet) => {
    const method = packet.method!;
    methods.push(method);
    if (method === "session/resume") {
      expect(packet.params).toMatchObject({
        sessionId: id,
        _meta: {
          antigravity: { systemPrompt: { append: "current instructions" } },
        },
      });
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
