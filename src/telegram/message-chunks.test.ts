import { describe, expect, test } from "bun:test";
import { splitTelegramMessage } from "./message-chunks.ts";

describe("splitTelegramMessage", () => {
  test("leaves short messages unchanged", () => {
    expect(splitTelegramMessage("hello", 10)).toEqual(["hello"]);
  });

  test("splits at natural boundaries within the limit", () => {
    const chunks = splitTelegramMessage("alpha beta gamma delta", 12);
    expect(chunks).toEqual(["alpha beta ", "gamma delta"]);
    expect(chunks.every((chunk) => chunk.length <= 12)).toBe(true);
  });

  test("hard-splits long unbroken content", () => {
    const chunks = splitTelegramMessage("x".repeat(25), 10);
    expect(chunks.map((chunk) => chunk.length)).toEqual([10, 10, 5]);
  });

  test("keeps a table intact across the old 4096-character boundary", () => {
    const text = "| Model | Result |\n| --- | --- |\n" + "| Example | Pass |\n".repeat(300);
    expect(splitTelegramMessage(text)).toEqual([text]);
  });

  test("prefers a paragraph boundary before a table that fits in the next message", () => {
    const intro = "x".repeat(32000) + "\n\n";
    const table = "| Model | Result |\n| --- | --- |\n" + "| Example | Pass |\n".repeat(100);
    expect(splitTelegramMessage(intro + table)).toEqual([intro, table]);
  });

  test("splitting preserves Unicode, whitespace and code indentation", () => {
    const text = "a".repeat(32767) + "😀\n  indented\n\n" + "🧪".repeat(18000);
    const chunks = splitTelegramMessage(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 32768 && chunk.isWellFormed())).toBe(true);
  });

  test("does not create empty Telegram messages from leading or trailing blank paragraphs", () => {
    expect(splitTelegramMessage("\n\n" + "x".repeat(20) + "\n\n", 10)).toEqual(["x".repeat(10), "x".repeat(10)]);
  });

  test.each([0, 1, -1, 1.5, NaN])("rejects unusable limit %s", (limit) => {
    expect(() => splitTelegramMessage("hello", limit)).toThrow();
  });
});
