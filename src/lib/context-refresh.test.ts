import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildContextBootstrapPrompt,
  buildContextHandoffPrompt,
  CONTEXT_HANDOFF_READY,
  CONTEXT_REFRESH_READY,
  createContextHandoffPath,
  validateContextHandoff,
} from "./context-refresh.ts";

describe("context refresh", () => {
  test("creates a safe persistent handoff path", async () => {
    const root = await mkdtemp(join(tmpdir(), "rachel-context-refresh-"));
    try {
      const path = await createContextHandoffPath(root, "scheduled:robot/media");
      expect(path).toContain(join("rachel-memory", "context-refresh"));
      expect(path).toContain("scheduled_robot_media-");
      expect(path.endsWith(".md")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("builds explicit preparation and bootstrap prompts", () => {
    const preparation = buildContextHandoffPrompt(
      "/skills/context-refresh/SKILL.md",
      "/shared/handoff.md",
    );
    expect(preparation).toContain("/skills/context-refresh/SKILL.md");
    expect(preparation).toContain("/shared/handoff.md");
    expect(preparation).toContain(CONTEXT_HANDOFF_READY);

    const bootstrap = buildContextBootstrapPrompt("/shared/handoff.md");
    expect(bootstrap).toContain("/shared/handoff.md");
    expect(bootstrap).toContain(CONTEXT_REFRESH_READY);
  });

  test("accepts useful handoffs and rejects tiny ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "rachel-context-refresh-"));
    const usefulPath = join(root, "useful.md");
    const tinyPath = join(root, "tiny.md");
    try {
      await writeFile(
        usefulPath,
        "# Current objective\nContinue the active implementation with exact paths and verified next actions.",
      );
      await writeFile(tinyPath, "too small");
      await expect(validateContextHandoff(usefulPath)).resolves.toBeUndefined();
      await expect(validateContextHandoff(tinyPath)).rejects.toThrow("too small");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
