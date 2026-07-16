import { describe, expect, test } from "bun:test";
import { splitTelegramMessage } from "./message-chunks.ts";

describe("splitTelegramMessage", () => {
  test("leaves short messages unchanged", () => {
    expect(splitTelegramMessage("hello", 10)).toEqual(["hello"]);
  });

  test("splits at natural boundaries within the limit", () => {
    const chunks = splitTelegramMessage("alpha beta gamma delta", 12);
    expect(chunks).toEqual(["alpha beta", "gamma delta"]);
    expect(chunks.every((chunk) => chunk.length <= 12)).toBe(true);
  });

  test("hard-splits long unbroken content", () => {
    const chunks = splitTelegramMessage("x".repeat(25), 10);
    expect(chunks.map((chunk) => chunk.length)).toEqual([10, 10, 5]);
  });
});
