import { describe, expect, test } from "bun:test";
import { formatProviderName, normalizeProvider } from "../ai/provider.ts";

describe("normalizeProvider", () => {
  test("normalizes claude alias", () => {
    expect(normalizeProvider("claude")).toBe("claudecode");
  });

  test("accepts claudecode", () => {
    expect(normalizeProvider("claudecode")).toBe("claudecode");
  });

  test("accepts codex", () => {
    expect(normalizeProvider("codex")).toBe("codex");
  });

  test("rejects unknown provider", () => {
    expect(normalizeProvider("gemini")).toBeNull();
  });
});

describe("formatProviderName", () => {
  test("formats claudecode", () => {
    expect(formatProviderName("claudecode")).toBe("Claude Code");
  });

  test("formats codex", () => {
    expect(formatProviderName("codex")).toBe("Codex");
  });
});
