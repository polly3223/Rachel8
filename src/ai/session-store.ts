import { env } from "../config/env.ts";
import { WorkStore } from "../lib/work-store.ts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let store: WorkStore | undefined;
export function getStore(): WorkStore {
  if (store) return store;
  const candidate = new WorkStore(join(env.SHARED_FOLDER_PATH, "rachel-memory", "tasks.db"));
  try {
    candidate.db.transaction(() => {
      for (const provider of ["codex", "claude"]) {
        const current = join(env.SHARED_FOLDER_PATH, `.${provider}-sessions.json`);
        const legacy = join(env.SHARED_FOLDER_PATH, ".sessions.json");
        const path = existsSync(current) ? current : provider === "claude" ? legacy : current;
        if (!existsSync(path)) continue;
        const entries: unknown = JSON.parse(readFileSync(path, "utf8"));
        if (!entries || typeof entries !== "object" || Array.isArray(entries))
          throw new Error(`Invalid legacy sessions: ${path}`);
        for (const [key, id] of Object.entries(entries)) {
          if (typeof id === "string")
            candidate.db.run("INSERT OR IGNORE INTO sessions(provider,key,id) VALUES(?,?,?)", [
              provider,
              key,
              id,
            ]);
        }
      }
    })();
  } catch (error) {
    candidate.db.close();
    throw error;
  }
  return (store = candidate);
}
