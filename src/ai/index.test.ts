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
