import { expect, test } from "bun:test";

test("failed context bootstrap preserves the original conversation mapping", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      "./scripts/test-env.ts",
      "--eval",
      `
    import { mock } from "bun:test";
    Bun.env.AI_PROVIDER = "codex";
    mock.module("./src/ai/auth.ts", () => ({ assertProviderAuthenticated: async () => {}, isProviderAuthFailure: () => false, ProviderAuthError: Error }));
    let turns = 0;
    mock.module("./src/ai/codex.ts", () => ({ runCodex: async options => {
      turns++;
      if (turns === 1) {
        options.onSession("original-thread");
        const path = options.input.text.match(/Write the handoff to this exact path: (.+)/)[1];
        await Bun.write(path, "Saved project state and completed actions. Keep the owner preferences and resume the pending review.");
        return {text:"CONTEXT_HANDOFF_READY"};
      }
      options.onSession("failed-bootstrap-thread");
      throw new Error("capacity");
    }}));
    const {getStore} = await import("./src/ai/session-store.ts");
    const {refreshConversationContext} = await import("./src/ai/index.ts");
    getStore().saveSession("codex", "owner", "original-thread");
    let failed = false;
    try { await refreshConversationContext("owner"); } catch { failed = true; }
    if (!failed || turns !== 2 || getStore().session("codex", "owner") !== "original-thread") throw new Error("Original mapping lost or work retried");
    if (getStore().db.query("SELECT * FROM sessions").all().length !== 1) throw new Error("Staged mapping leaked");
  `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  expect({ code, error }).toEqual({ code: 0, error: "" });
});

test("antigravity keeps system instructions static across turns and passes dynamic context in the user turn", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      "./scripts/test-env.ts",
      "--eval",
      `
    import { mock } from "bun:test";
    Bun.env.AI_PROVIDER = "antigravity";
    mock.module("./src/ai/auth.ts", () => ({ assertProviderAuthenticated: async () => {}, isProviderAuthFailure: () => false, ProviderAuthError: Error }));
    const seen = [];
    mock.module("./src/ai/antigravity.ts", () => ({
      AntigravitySessionUnavailable: class extends Error {},
      runAntigravity: async options => {
        seen.push({ instructions: options.instructions, text: options.input.text, sessionId: options.sessionId });
        options.onSession("agy-session-1");
        return { text: "OK" };
      },
    }));
    const { generate } = await import("./src/ai/index.ts");
    await generate("239639387", { text: "hello 1" }, { runId: 101 });
    await generate("239639387", { text: "hello 2" }, { runId: 102 });
    if (seen.length !== 2) throw new Error("Expected 2 turns");
    if (seen[0].instructions !== seen[1].instructions) throw new Error("Static instructions drifted across turns");
    if (seen[0].instructions.includes("Current work ID")) throw new Error("Dynamic work ID leaked into static instructions");
    if (!seen[0].text.includes("Current work ID: 101") || !seen[1].text.includes("Current work ID: 102"))
      throw new Error("Dynamic work ID missing from turn context");
    if (seen[1].sessionId !== "agy-session-1") throw new Error("Session ID was not resumed");
  `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  expect({ code, error }).toEqual({ code: 0, error: "" });
});
