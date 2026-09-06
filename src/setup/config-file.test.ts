import { expect, test } from "bun:test";
import { mergeEnv } from "./config-file.ts";
import { redactSecrets } from "../lib/memory.ts";
import { fileMethod } from "../telegram/delivery.ts";

test("setup preserves optional settings and safely quotes updated values", () => {
  expect(
    mergeEnv("# mine\nCODEX_MODEL=chosen\nSHARED_FOLDER_PATH=/old\n", {
      SHARED_FOLDER_PATH: "/new path",
      AI_PROVIDER: "codex",
    }),
  ).toBe('# mine\nCODEX_MODEL=chosen\nSHARED_FOLDER_PATH="/new path"\n\nAI_PROVIDER="codex"\n');
});
test("logs mask known credentials while retaining ordinary text", () => {
  expect(redactSecrets("key sk-proj-" + "a".repeat(40))).not.toContain("a".repeat(40));
  expect(redactSecrets("password=secret123 normal text")).toBe(
    "password=[credential redacted] normal text",
  );
});
test("files route by supported format, with an original-file option", () => {
  expect(fileMethod("x.gif")).toBe("sendAnimation");
  expect(fileMethod("x.svg")).toBe("sendDocument");
  expect(fileMethod("x.png", true)).toBe("sendDocument");
});
