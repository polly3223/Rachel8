import { expect, test } from "bun:test";
import { runCodex } from "./codex.ts";
import { RpcClient } from "./rpc.ts";
import type { Input } from "./turn.ts";

function fake(
  start: (client: RpcClient) => void,
  onSend?: (method: string, params: unknown) => void,
) {
  const client = new RpcClient((packet) => {
    onSend?.(packet.method ?? "", packet.params);
    if (typeof packet.id !== "number") return;
    if (packet.method === "thread/start" || packet.method === "thread/resume")
      queueMicrotask(() =>
        client.accept({ id: packet.id, result: { thread: { id: "saved-thread" } } }),
      );
    else if (packet.method === "turn/start")
      queueMicrotask(() => {
        client.accept({ id: packet.id, result: { turn: { id: "turn-one" } } });
        start(client);
      });
    else if (packet.method === "turn/steer" || packet.method === "turn/interrupt")
      queueMicrotask(() => client.accept({ id: packet.id, result: {} }));
  });
  return client;
}
const finish = (c: RpcClient) =>
  c.accept({
    method: "turn/completed",
    params: { threadId: "saved-thread", turn: { id: "turn-one", status: "completed" } },
  });

test("allocated thread is saved before the first turn can fail", async () => {
  let saved = "";
  const client = fake((c) =>
    c.accept({
      method: "turn/completed",
      params: {
        threadId: "saved-thread",
        turn: { id: "turn-one", status: "failed", error: { message: "capacity" } },
      },
    }),
  );
  await expect(
    runCodex(
      {
        input: { text: "test" },
        instructions: "test",
        signal: new AbortController().signal,
        onSession: (id) => {
          saved = id;
        },
      },
      client,
    ),
  ).rejects.toThrow("capacity");
  expect(saved).toBe("saved-thread");
});
test("progress forwards commentary, excludes reasoning, and keeps native image inputs", async () => {
  const progress: string[] = [];
  let input: unknown;
  const client = fake(
    (c) => {
      c.accept({
        method: "item/completed",
        params: {
          threadId: "saved-thread",
          item: { id: "secret", type: "reasoning", text: "private reasoning" },
        },
      });
      c.accept({
        method: "item/completed",
        params: {
          threadId: "saved-thread",
          item: { id: "note", type: "agentMessage", phase: "commentary", text: "Checking" },
        },
      });
      c.accept({
        method: "item/completed",
        params: {
          threadId: "saved-thread",
          item: { id: "done", type: "agentMessage", phase: "final_answer", text: "Done" },
        },
      });
      finish(c);
    },
    (method, params) => {
      if (method === "turn/start") input = params;
    },
  );
  const result = await runCodex(
    {
      input: { text: "test", images: ["/image.png"] },
      instructions: "test",
      signal: new AbortController().signal,
      onSession: () => {},
      onProgress: async (text) => {
        progress.push(text);
      },
    },
    client,
  );
  expect(result.text).toBe("Done");
  expect(progress).toEqual(["Checking"]);
  expect(JSON.stringify(input)).toContain('"type":"localImage"');
});
test("steering targets the exact active turn and cancellation interrupts it", async () => {
  let steer!: (input: Input) => Promise<void>;
  const calls: string[] = [];
  const controller = new AbortController();
  const client = fake(
    () => {},
    (method, params) => {
      calls.push(method);
      if (method === "turn/steer")
        expect(params).toMatchObject({ threadId: "saved-thread", expectedTurnId: "turn-one" });
    },
  );
  const task = runCodex(
    {
      input: { text: "test" },
      instructions: "test",
      signal: controller.signal,
      onSession: () => {},
      onControl: (value) => {
        steer = value;
      },
    },
    client,
  );
  await Bun.sleep(10);
  await steer({ text: "correction" });
  controller.abort();
  await expect(task).rejects.toThrow("Stopped");
  expect(calls).toContain("turn/interrupt");
});
test("interactive answers are associated with their original question IDs", async () => {
  const client = fake((c) => {
    setTimeout(() => finish(c), 15);
  });
  const task = runCodex(
    {
      input: { text: "test" },
      instructions: "test",
      signal: new AbortController().signal,
      onSession: () => {},
      ask: async () => "blue",
    },
    client,
  );
  await Bun.sleep(5);
  const response = await client.onRequest("item/tool/requestUserInput", {
    threadId: "saved-thread",
    questions: [{ id: "color", question: "Color?", options: [{ label: "blue" }] }],
  });
  expect(response).toEqual({ answers: { color: { answers: ["blue"] } } });
  await task;
});
