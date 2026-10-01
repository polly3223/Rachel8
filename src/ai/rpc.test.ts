import { test, expect } from "bun:test";
import { connectCodex, RpcClient } from "./rpc.ts";

test("RPC matches out-of-order replies and dispatches requests without blocking notifications", async () => {
  const sent: { id?: number | string; method?: string; result?: unknown }[] = [];
  const client = new RpcClient((packet) => {
    sent.push(packet);
  });
  const one = client.call("one", {}),
    two = client.call("two", {});
  client.accept({ id: 2, result: "second" });
  client.accept({ id: 1, result: "first" });
  expect(await one).toBe("first");
  expect(await two).toBe("second");
  let resolve!: (value: unknown) => void,
    event = false;
  client.onRequest = () =>
    new Promise((r) => {
      resolve = r;
    });
  client.onEvent = () => {
    event = true;
  };
  client.accept({ id: "ask", method: "input", params: {} });
  client.accept({ method: "progress", params: {} });
  expect(event).toBe(true);
  resolve({ answer: "yes" });
  await Bun.sleep(0);
  expect(sent.at(-1)).toEqual({ id: "ask", result: { answer: "yes" } });
  client.close();
});
test("closed transport rejects outstanding calls immediately", async () => {
  const client = new RpcClient(() => {});
  const call = client.call("long", {});
  client.close(new Error("process died"));
  await expect(call).rejects.toThrow("process died");
  await expect(client.call("next", {})).rejects.toThrow("closed");
});

test("stdio preserves Unicode separators and fragmented large replies", async () => {
  const client = await connectCodex(`${import.meta.dir}/fixtures/rpc-server.ts`);
  const events: unknown[] = [];
  client.onEvent = (_, params) => events.push(params);
  try {
    expect(await client.call<string>("unicode", {})).toBe("é🙂\u2028\u2029".repeat(100_000));
    expect(events).toEqual(["before\u2028middle\u2029after"]);
  } finally {
    client.close();
  }
});

test("malformed JSON closes pending calls without exposing payloads", async () => {
  const client = await connectCodex(`${import.meta.dir}/fixtures/rpc-server.ts`);
  await expect(client.call("invalid", {})).rejects.toThrow(/^Invalid Codex protocol message$/);
  await expect(client.call("next", {})).rejects.toThrow("closed");
});

test("event handler failures remain distinct from invalid JSON", async () => {
  const client = await connectCodex(`${import.meta.dir}/fixtures/rpc-server.ts`);
  const cause = new Error("handler failed");
  client.onEvent = () => {
    throw cause;
  };
  await expect(client.call("event", {})).rejects.toMatchObject({
    message: "Codex message handler failed",
    cause,
  });
});
