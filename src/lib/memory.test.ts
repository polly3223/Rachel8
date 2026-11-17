import { describe, expect, test } from "bun:test";
import { buildSystemPromptWithMemory, formatLocalDate, initializeMemorySystem, saveContext, searchMemory } from "./memory.ts";

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

describe("formatLocalDate", () => {
  test("uses the Italian calendar day near UTC midnight", () => {
    expect(formatLocalDate(new Date("2026-07-16T22:30:00Z"))).toBe("2026-07-17");
    expect(formatLocalDate(new Date("2026-01-16T23:30:00Z"))).toBe("2026-01-17");
  });
});
