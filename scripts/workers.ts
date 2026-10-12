import { getStore } from "../src/ai/session-store.ts";
import { manageWorker } from "../src/lib/workers.ts";
import { redactRecord } from "../src/lib/memory.ts";

const [runId, json] = process.argv.slice(2);
if (!runId || !json) throw new Error("Usage: bun run workers <current-work-id> '<action-json>'");
console.log(
  JSON.stringify(manageWorker(getStore(), Number(runId), redactRecord(JSON.parse(json))), null, 2),
);
