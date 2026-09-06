import { test, expect } from "bun:test";
import { RpcClient } from "./rpc.ts";

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
