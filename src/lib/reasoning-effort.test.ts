import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getReasoningEffort,
  parseReasoningEffort,
  setReasoningEffort,
} from "./reasoning-effort.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("reasoning effort", () => {
  test("normalizes supported values", () => {
    expect(parseReasoningEffort("HIGH")).toBe("high");
    expect(parseReasoningEffort("extra high")).toBe("xhigh");
    expect(parseReasoningEffort("max")).toBe("max");
    expect(parseReasoningEffort("ultra")).toBe("ultra");
    expect(parseReasoningEffort("minimal")).toBeNull();
  });

  test("defaults to medium and persists changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rachel-effort-"));
    temporaryDirectories.push(directory);

    expect(await getReasoningEffort(directory)).toBe("medium");
    await setReasoningEffort(directory, "high");
    expect(await getReasoningEffort(directory)).toBe("high");
  });
});

test("Antigravity effort stays independent of the Codex preference across switches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rachel-provider-effort-"));
  temporaryDirectories.push(dir);
  await setReasoningEffort(dir, "ultra");
  expect(await getReasoningEffort(dir, "xhigh", "antigravity")).toBe("xhigh");
  await setReasoningEffort(dir, "medium", "antigravity");
  await expect(setReasoningEffort(dir, "max", "antigravity")).rejects.toThrow("Neon");
  expect(await getReasoningEffort(dir)).toBe("ultra");
  expect(await getReasoningEffort(dir, "xhigh", "antigravity")).toBe("medium");
});
