import { describe, expect, test } from "bun:test";
import { safeTelegramFileName } from "./file.ts";

describe("safeTelegramFileName", () => {
  test("removes path traversal and unsafe characters", () => {
    expect(safeTelegramFileName("../../report?.pdf")).toBe("report_.pdf");
  });

  test("provides a fallback for empty names", () => {
    expect(safeTelegramFileName("..")).toBe("file");
  });
});
