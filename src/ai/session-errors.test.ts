import { describe, expect, test } from "bun:test";
import {
  isCodexThreadUnavailableError,
  isContextOverflowError,
} from "./session-errors.ts";

describe("isCodexThreadUnavailableError", () => {
  test("recognizes errors that require a fresh thread", () => {
    expect(isCodexThreadUnavailableError("thread_not_found")).toBe(true);
    expect(isCodexThreadUnavailableError("Failed to resume thread abc")).toBe(true);
    expect(isCodexThreadUnavailableError("Thread not found: abc")).toBe(true);
  });

  test("does not retry unrelated not-found errors", () => {
    expect(isCodexThreadUnavailableError("File not found: report.md")).toBe(false);
    expect(isCodexThreadUnavailableError("Linear issue not found")).toBe(false);
  });
});

describe("isContextOverflowError", () => {
  test("recognizes common context limit errors", () => {
    expect(isContextOverflowError("maximum context length exceeded")).toBe(true);
    expect(isContextOverflowError("Prompt is too long")).toBe(true);
  });

  test("does not match ordinary context references", () => {
    expect(isContextOverflowError("Could not read context file")).toBe(false);
  });
});
