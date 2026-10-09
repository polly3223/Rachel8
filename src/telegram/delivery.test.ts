import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import type { Message } from "grammy/types";
import { GrammyError } from "grammy";
import { sendChunks, sendText, telegram } from "./delivery.ts";

const sent = spyOn(telegram, "sendMessage");
const rich = spyOn(telegram, "sendRichMessage");
beforeEach(() => {
  sent.mockReset().mockResolvedValue({ message_id: 1 } as Message.TextMessage);
  rich.mockReset().mockResolvedValue({ message_id: 2 } as Message.RichMessageMessage);
});
afterAll(() => {
  sent.mockRestore();
  rich.mockRestore();
});

test("plain login notifications preserve OAuth URLs and callback commands", async () => {
  sent.mockResolvedValue({ message_id: 1 } as Message.TextMessage);
  const url = "https://mcp.linear.app/authorize?response_type=code&client_id=client_id&code_challenge=a_b&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcallback%2Fa_b";
  const prompt = `Linear authorization is ready.\n${url}\n/connector_callback <complete URL>`;
  await sendChunks(1, prompt, false);
  expect(sent).toHaveBeenCalledTimes(1);
  expect(sent.mock.calls[0]?.[1]).toBe(prompt);
  expect(sent.mock.calls[0]?.[2]?.parse_mode).toBeUndefined();
  expect(rich).not.toHaveBeenCalled();
});

test("rich tables and code over the old limit are delivered intact with one receipt", async () => {
  const table = "| Model | Result |\n| --- | --- |\n" + "| Example | **Passed** |\n".repeat(200);
  const text = `## Results\n\n${table}\n\n\`\`\`ts\nconst ready = true;\n\`\`\``;
  await sendChunks(1, text);
  expect(rich).toHaveBeenCalledTimes(1);
  expect(rich).toHaveBeenCalledWith(1, { markdown: text });
  expect(sent).not.toHaveBeenCalled();
});

test("formatting rejection falls back to one rich paragraph, even above 4096 characters", async () => {
  const text = "| invalid |".repeat(500);
  rich.mockRejectedValueOnce(new GrammyError("invalid formatting", {
    ok: false, error_code: 400, description: "Bad Request: can't parse rich message",
  }, "sendRichMessage", {}));
  expect(await sendText(1, text)).toBe(2);
  expect(rich).toHaveBeenCalledTimes(2);
  expect(rich.mock.calls[1]).toEqual([1, { blocks: [{ type: "paragraph", text }] }]);
  expect(sent).not.toHaveBeenCalled();
});

test.each([
  new Error("connection lost after send"),
  new GrammyError("rate limited", { ok: false, error_code: 429, description: "Too Many Requests" }, "sendRichMessage", {}),
  new GrammyError("server error", { ok: false, error_code: 500, description: "rich message failed" }, "sendRichMessage", {}),
  new GrammyError("unknown chat", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "sendRichMessage", {}),
])("delivery failures propagate without a second send: %s", async (error) => {
  rich.mockRejectedValueOnce(error);
  await expect(sendText(1, "**Hello**")).rejects.toThrow(error);
  expect(rich).toHaveBeenCalledTimes(1);
  expect(sent).not.toHaveBeenCalled();
});

test("plain notifications still split at 4096 and empty responses send nothing", async () => {
  await sendChunks(1, "x".repeat(5000), false);
  expect(sent.mock.calls.map((call) => call[1].length)).toEqual([4096, 904]);
  await sendChunks(1, "No response needed.");
  expect(rich).not.toHaveBeenCalled();
});
