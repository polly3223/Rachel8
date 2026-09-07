import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import type { Message } from "grammy/types";
import { sendChunks, telegram } from "./delivery.ts";

const sent = spyOn(telegram, "sendMessage");
beforeEach(() => sent.mockClear());
afterAll(() => sent.mockRestore());

test("plain login notifications preserve OAuth URLs and callback commands", async () => {
  sent.mockResolvedValue({ message_id: 1 } as Message.TextMessage);
  const url = "https://mcp.linear.app/authorize?response_type=code&client_id=client_id&code_challenge=a_b&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcallback%2Fa_b";
  const prompt = `Linear authorization is ready.\n${url}\n/connector_callback <complete URL>`;
  await sendChunks(1, prompt, false);
  expect(sent).toHaveBeenCalledTimes(1);
  expect(sent.mock.calls[0]?.[1]).toBe(prompt);
  expect(sent.mock.calls[0]?.[2]?.parse_mode).toBeUndefined();
});

test("ordinary replies still use Markdown", async () => {
  sent.mockResolvedValue({ message_id: 1 } as Message.TextMessage);
  await sendChunks(1, "*Done*");
  expect(sent.mock.calls[0]?.[2]?.parse_mode).toBe("Markdown");
});
