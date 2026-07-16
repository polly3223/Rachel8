import { describe, expect, test } from "bun:test";
import { formatLocalDate } from "./memory.ts";

describe("formatLocalDate", () => {
  test("uses the Italian calendar day near UTC midnight", () => {
    expect(formatLocalDate(new Date("2026-07-16T22:30:00Z"))).toBe("2026-07-17");
    expect(formatLocalDate(new Date("2026-01-16T23:30:00Z"))).toBe("2026-01-17");
  });
});
