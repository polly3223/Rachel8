import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Cron } from "croner";
import { z } from "zod";
import { parseAgentTaskContext } from "./task-context.ts";

export const taskData = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent"),
    data: z.object({ prompt: z.string().min(1), context: z.string().optional() }).passthrough(),
  }),
  z.object({
    type: z.literal("reminder"),
    data: z.object({ message: z.string().min(1) }).passthrough(),
  }),
  z.object({
    type: z.literal("bash"),
    data: z.object({ command: z.string().min(1) }).passthrough(),
  }),
  z.object({
    type: z.literal("cleanup"),
    data: z.object({ targets: z.array(z.string().min(1)).min(1) }).passthrough(),
  }),
]);
export type TaskType = z.infer<typeof taskData>["type"];
export interface Task {
  id: number;
  name: string;
  type: TaskType;
  data: string;
  cron: string | null;
  timezone: string;
  next_run: number;
  enabled: number;
}
export interface Work {
  id: number;
  task_id: number | null;
  kind: "task" | "telegram";
  key: string;
  state: string;
  body: string;
  result: string | null;
  delivery: string | null;
  delivered: number;
  attempts: number;
  next_delivery: number;
  activity: string;
  usage: string | null;
  created_at: number;
  started_at: number | null;
  checkpoint: string | null;
}
export interface Output {
  text: string;
  artifacts?: string[];
}

export function nextCron(pattern: string, timezone: string, after = Date.now()): number {
  if (pattern.trim().split(/\s+/).length !== 5) throw new Error("Use a five-field cron expression");
  new Intl.DateTimeFormat("en", { timeZone: timezone });
  const next = new Cron(pattern, { timezone, domAndDow: false }).nextRun(new Date(after));
  if (!next) throw new Error("Schedule has no next occurrence");
  return next.getTime();
}

/** One durable queue for scheduled work and Telegram intake; delivery never reruns work. */
export class WorkStore {
  readonly db: Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    const legacy = this.db.query("SELECT sql FROM sqlite_master WHERE name='tasks'").get() as {
      sql: string;
    } | null;
    if (legacy && /CHECK/i.test(legacy.sql) && !legacy.sql.includes("'agent'")) {
      this.db
        .transaction(() => {
          this.db.exec(
            legacy.sql
              .replace(/CREATE TABLE\s+["`]?tasks["`]?/i, "CREATE TABLE tasks_new")
              .replace(/CHECK\s*\(\s*type\s+IN\s*\([^)]*\)\s*\)/i, ""),
          );
          this.db.exec(
            "INSERT INTO tasks_new SELECT * FROM tasks; DROP TABLE tasks; ALTER TABLE tasks_new RENAME TO tasks",
          );
        })
        .immediate();
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        type TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', cron TEXT, next_run INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000));
      CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, kind TEXT NOT NULL,
        key TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', body TEXT NOT NULL,
        result TEXT, delivery TEXT, delivered INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
        next_delivery INTEGER NOT NULL DEFAULT 0, delivery_error TEXT, activity TEXT NOT NULL DEFAULT 'Queued',
        usage TEXT, checkpoint TEXT, created_at INTEGER NOT NULL, started_at INTEGER, heartbeat INTEGER);
      CREATE INDEX IF NOT EXISTS runs_queue ON runs(state,created_at);
      CREATE TABLE IF NOT EXISTS telegram_updates (id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery_receipts (run_id INTEGER NOT NULL, part INTEGER NOT NULL, message_id INTEGER NOT NULL, PRIMARY KEY(run_id,part));
      CREATE TABLE IF NOT EXISTS sessions (provider TEXT NOT NULL, key TEXT NOT NULL, id TEXT NOT NULL,
        previous_id TEXT, PRIMARY KEY(provider,key));`);
    const columns = this.db.query("PRAGMA table_info(tasks)").all() as { name: string }[];
    // Legacy expressions were UTC. New schedules use the owner's zone.
    if (!columns.some((c) => c.name === "timezone"))
      this.db.exec("ALTER TABLE tasks ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'");
  }
  add(
    name: string,
    type: TaskType,
    data: unknown,
    options: { cron?: string; delayMs?: number; timezone?: string } = {},
  ): Task {
    const parsed = taskData.parse({ type, data });
    if (parsed.type === "agent") parseAgentTaskContext(parsed.data.context);
    if (!name.trim()) throw new Error("Task name is required");
    if (options.cron !== undefined && !options.cron.trim())
      throw new Error("Cron expression cannot be empty");
    const delay = z
      .number()
      .finite()
      .nonnegative()
      .parse(options.delayMs ?? 0);
    const timezone = options.timezone ?? "Europe/Rome";
    const next = options.cron ? nextCron(options.cron, timezone) : Date.now() + delay;
    return this.db
      .query(
        "INSERT INTO tasks(name,type,data,cron,next_run,timezone) VALUES(?,?,?,?,?,?) RETURNING *",
      )
      .get(name, type, JSON.stringify(parsed.data), options.cron ?? null, next, timezone) as Task;
  }
  enqueue(
    kind: Work["kind"],
    key: string,
    body: unknown,
    taskId: number | null = null,
    when = Date.now(),
  ): Work {
    return this.db
      .query("INSERT INTO runs(kind,key,body,task_id,created_at) VALUES(?,?,?,?,?) RETURNING *")
      .get(kind, key, JSON.stringify(body), taskId, when) as Work;
  }
  due(now = Date.now()): void {
    this.db
      .transaction(() => {
        const tasks = this.db
          .query(
            `SELECT * FROM tasks WHERE enabled=1 AND next_run<=? AND NOT EXISTS
        (SELECT 1 FROM runs WHERE task_id=tasks.id AND state IN ('queued','running'))`,
          )
          .all(now) as Task[];
        for (const task of tasks) {
          try {
            const parsed = taskData.parse({ type: task.type, data: JSON.parse(task.data) });
            const context =
              parsed.type === "agent"
                ? parseAgentTaskContext(parsed.data.context)
                : String(task.id);
            const next = task.cron ? nextCron(task.cron, task.timezone, now) : task.next_run;
            this.enqueue(
              "task",
              context === "shared" ? "-1" : `scheduled:${context}`,
              task,
              task.id,
              now,
            );
            this.db.run("UPDATE tasks SET next_run=?,enabled=? WHERE id=?", [
              next,
              task.cron ? 1 : 0,
              task.id,
            ]);
          } catch (error) {
            const run = this.enqueue("task", `invalid:${task.id}`, task, task.id, now);
            this.finish(run.id, "failed", {
              text: `Task ${task.name} could not be scheduled: ${String(error)}`,
            });
            this.db.run("UPDATE tasks SET enabled=0 WHERE id=?", [task.id]);
          }
        }
      })
      .immediate();
  }
  claim(kind?: Work["kind"], now = Date.now()): Work | null {
    return this.db
      .transaction(() => {
        const run = this.db
          .query(
            `SELECT * FROM runs r WHERE state='queued' AND created_at<=?
        AND (? IS NULL OR kind=?) AND NOT EXISTS(SELECT 1 FROM runs a WHERE a.key=r.key
          AND (a.state='running' OR (a.state IN ('queued','steering') AND a.id<r.id)))
        ORDER BY created_at,id LIMIT 1`,
          )
          .get(now, kind ?? null, kind ?? null) as Work | null;
        if (run)
          this.db.run(
            "UPDATE runs SET state='running',started_at=?,heartbeat=?,activity='Starting' WHERE id=?",
            [now, now, run.id],
          );
        return run;
      })
      .immediate();
  }
  finish(id: number, state: string, output: Output): void {
    this.db.run("UPDATE runs SET state=?,result=?,activity=?,heartbeat=NULL WHERE id=?", [
      state,
      JSON.stringify(output),
      state,
      id,
    ]);
  }
  recover(): void {
    // Interrupted tools may already have performed external actions. Keep checkpoints;
    // resumption is explicit, never an automatic replay of uncertain side effects.
    const runs = this.db
      .query("SELECT * FROM runs WHERE state IN ('running','steering')")
      .all() as Work[];
    for (const run of runs)
      this.finish(run.id, "interrupted", {
        text: `Work #${run.id} was interrupted by a restart. Its conversation and checkpoint are saved. Use /resume ${run.id} to continue after checking completed actions.`,
      });
  }
  resume(id: number): Work {
    return this.db
      .transaction(() => {
        const run = this.get(id);
        if (!run || !["interrupted", "failed", "cancelled"].includes(run.state))
          throw new Error("Only interrupted, failed or cancelled work can be resumed");
        const resumed = this.db
          .query(
            "SELECT * FROM runs WHERE json_extract(body,'$.resumeOf')=? ORDER BY id DESC LIMIT 1",
          )
          .get(id) as Work | null;
        if (resumed) {
          if (["queued", "running"].includes(resumed.state)) return resumed;
          throw new Error(
            `Work was already resumed as #${resumed.id} (${resumed.state}); inspect that run before continuing`,
          );
        }
        return this.enqueue(
          run.kind,
          run.key,
          { ...JSON.parse(run.body), resumeOf: id },
          run.task_id,
        );
      })
      .immediate();
  }
  cancelSchedule(name: string): void {
    this.db
      .transaction(() => {
        this.db.run("UPDATE tasks SET enabled=0 WHERE name=?", [name]);
        this.db.run(
          "UPDATE runs SET state='cancelled',activity='Cancelled' WHERE state='queued' AND task_id IN (SELECT id FROM tasks WHERE name=?)",
          [name],
        );
      })
      .immediate();
  }
  get(id: number): Work | null {
    return this.db.query("SELECT * FROM runs WHERE id=?").get(id) as Work | null;
  }
  recent(limit = 10): Work[] {
    return this.db.query("SELECT * FROM runs ORDER BY id DESC LIMIT ?").all(limit) as Work[];
  }
  pendingDelivery(now = Date.now()): Work[] {
    return this.db
      .query(
        "SELECT * FROM runs WHERE result IS NOT NULL AND delivered>=0 AND attempts<6 AND next_delivery<=? ORDER BY id",
      )
      .all(now) as Work[];
  }
  progress(id: number, activity: string, usage?: unknown): void {
    this.db.run("UPDATE runs SET activity=?,heartbeat=?,usage=COALESCE(?,usage) WHERE id=?", [
      activity,
      Date.now(),
      usage ? JSON.stringify(usage) : null,
      id,
    ]);
  }
  cancelQueued(key: string): void {
    this.db.run(
      "UPDATE runs SET state='cancelled',activity='Cancelled' WHERE key=? AND state IN ('queued','steering')",
      [key],
    );
  }
  session(provider: string, key: string): string | undefined {
    return (
      this.db.query("SELECT id FROM sessions WHERE provider=? AND key=?").get(provider, key) as {
        id: string;
      } | null
    )?.id;
  }
  saveSession(provider: string, key: string, id: string): void {
    this.db.run(
      `INSERT INTO sessions(provider,key,id) VALUES(?,?,?) ON CONFLICT(provider,key) DO UPDATE SET
      previous_id=CASE WHEN id<>excluded.id THEN id ELSE previous_id END,id=excluded.id`,
      [provider, key, id],
    );
  }
}
