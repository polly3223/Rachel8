import { describe, expect, test } from "bun:test";
import { formatZurichDate } from "./memory.ts";

describe("formatZurichDate", () => {
  test("uses the Zurich calendar day near UTC midnight", () => {
    expect(formatZurichDate(new Date("2026-07-16T22:30:00Z"))).toBe("2026-07-17");
    expect(formatZurichDate(new Date("2026-01-16T23:30:00Z"))).toBe("2026-01-17");
  });
});
