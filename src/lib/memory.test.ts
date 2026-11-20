import { describe, expect, test } from "bun:test";
import {
  buildStaticSystemPrompt,
  buildSystemPromptWithMemory,
  buildTurnContext,
  formatLocalDate,
  initializeMemorySystem,
  saveContext,
  searchMemory,
} from "./memory.ts";
import { getStore } from "../ai/session-store.ts";

test("ranks the named project across all topics and loads it when mentioned naturally", async () => {
  await initializeMemorySystem();
  for (let n = 0; n < 10; n++) await saveContext(`aaa-review-${n}`, "Casual mention of attestation.");
  await saveContext("prem-exampleclient", "Customer overview.\n" + "x".repeat(2800) + "\nAttestation uses the project-specific reference.");
  const results = await searchMemory("ExampleClient attestation");
  expect(results).toHaveLength(8);
  expect(results[0]?.topic).toBe("prem-exampleclient");
  expect(results[0]?.excerpt).toContain("project-specific reference");
  expect(await searchMemory("?!")).toEqual([]);
  const prompt = await buildSystemPromptWithMemory("base", "legacy", "Parliamo di ExampleClient.");
  expect(prompt).toContain("prem-exampleclient:\nCustomer overview");
  expect(prompt).not.toContain("Casual mention of attestation.");
});

test("separates static system prompt from per-turn context and omits empty background reports", async () => {
  await initializeMemorySystem();
  const store = getStore();
  const emptyRun = store.enqueue("task", "scheduled:silent-bash", { type: "bash" });
  store.finish(emptyRun.id, "succeeded", { text: "" });
  const quietRun = store.enqueue("task", "scheduled:watch", { type: "agent" });
  store.finish(quietRun.id, "succeeded", { text: "No response needed." });
  const usefulRun = store.enqueue("task", "scheduled:digest", { type: "agent" });
  store.finish(usefulRun.id, "succeeded", { text: "Digest summary ready." });

  const staticPrompt = await buildStaticSystemPrompt("BASE_RULES");
  expect(staticPrompt).toContain("BASE_RULES");
  expect(staticPrompt).not.toContain("Current work ID");
  expect(staticPrompt).not.toContain("Digest summary ready.");

  const turnContext = await buildTurnContext("239639387", "Parliamo di ExampleClient.", 999);
  expect(turnContext).toContain("Current work ID: 999; conversation: 239639387.");
  expect(turnContext).toContain("Digest summary ready.");
  expect(turnContext).not.toContain("silent-bash");
  expect(turnContext).not.toContain("No response needed.");
});

describe("formatLocalDate", () => {
  test("uses the Italian calendar day near UTC midnight", () => {
    expect(formatLocalDate(new Date("2026-07-16T22:30:00Z"))).toBe("2026-07-17");
    expect(formatLocalDate(new Date("2026-01-16T23:30:00Z"))).toBe("2026-01-17");
  });
});
