import { env } from "../src/config/env.ts";
import {
  getReasoningEffort,
  parseReasoningEffort,
  REASONING_EFFORTS,
  setReasoningEffort,
} from "../src/lib/reasoning-effort.ts";

const [action = "get", requested] = Bun.argv.slice(2);

if (action === "get") {
  console.log(await getReasoningEffort(env.SHARED_FOLDER_PATH, env.AI_PROVIDER === "antigravity" ? "xhigh" : Bun.env["CODEX_REASONING_EFFORT"], env.AI_PROVIDER));
  process.exit(0);
}

if (action === "set" && requested) {
  const effort = parseReasoningEffort(requested);
  if (!effort) {
    console.error(`Invalid effort. Choose one of: ${REASONING_EFFORTS.join(", ")}`);
    process.exit(1);
  }
  await setReasoningEffort(env.SHARED_FOLDER_PATH, effort, env.AI_PROVIDER);
  console.log(effort);
  process.exit(0);
}

console.error("Usage: bun run effort [get | set <low|medium|high|xhigh|max|ultra>]");
process.exit(1);
