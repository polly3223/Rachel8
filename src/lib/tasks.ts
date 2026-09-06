import { getStore } from "../ai/session-store.ts";
import {
  taskData,
  type WorkStore,
  type Work,
  type Task,
  type TaskType,
  type Output,
} from "./work-store.ts";
import { splitTelegramMessage } from "../telegram/message-chunks.ts";
import { shouldSend } from "../telegram/delivery.ts";
import { redactSecrets } from "./memory.ts";
import { logger } from "./logger.ts";

export interface Delivery {
  chat: number;
  text?: string;
  path?: string;
}
export interface WorkerHooks {
  execute: (run: Work, signal: AbortSignal) => Promise<Output>;
  send: (item: Delivery) => Promise<number>;
  owner: number;
}
/** Execution and delivery have independent lifecycles. A send retry cannot rerun a tool. */
export class WorkRunner {
  private timer?: ReturnType<typeof setInterval>;
  private active = new Map<number, AbortController>();
  private delivering = false;
  private stopped = false;
  constructor(
    readonly store: WorkStore,
    readonly hooks: WorkerHooks,
  ) {}
  start(): void {
    this.store.recover();
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
  }
  tick(): void {
    if (this.stopped) return;
    this.store.due();
    // Reserve foreground capacity even while two unrelated background jobs are running.
    for (const kind of ["telegram", "task"] as const) {
      let count = [...this.active.keys()].filter((id) => this.store.get(id)?.kind === kind).length;
      while (count < 2) {
        const run = this.store.claim(kind);
        if (!run) break;
        const abort = new AbortController();
        this.active.set(run.id, abort);
        count++;
        void this.hooks
          .execute(run, abort.signal)
          .then(
            (output) => this.store.finish(run.id, "succeeded", output),
            (error) =>
              this.store.finish(
                run.id,
                this.stopped ? "interrupted" : abort.signal.aborted ? "cancelled" : "failed",
                {
                  text: this.stopped
                    ? `Work #${run.id} was interrupted by a restart. Its checkpoint is saved; use /resume ${run.id} to recover it.`
                    : abort.signal.aborted
                      ? `Stopped work #${run.id}.`
                      : `Work #${run.id} failed: ${redactSecrets(String(error))}`,
                },
              ),
          )
          .catch((error) =>
            logger.error("Cannot persist work result", { runId: run.id, error: String(error) }),
          )
          .finally(() => this.active.delete(run.id));
      }
    }
    if (!this.delivering) void this.deliver();
  }
  async deliver(): Promise<void> {
    this.delivering = true;
    try {
      for (const run of this.store.pendingDelivery()) {
        if (this.stopped) break;
        try {
          const output = JSON.parse(run.result!) as Output;
          const chat = run.kind === "telegram" ? Number(run.key) : this.hooks.owner;
          const items: Delivery[] = run.delivery
            ? JSON.parse(run.delivery)
            : [
                ...(shouldSend(output.text)
                  ? splitTelegramMessage(output.text).map((text) => ({ chat, text }))
                  : []),
                ...(output.artifacts ?? []).map((path) => ({ chat, path })),
              ];
          if (!run.delivery)
            this.store.db.run("UPDATE runs SET delivery=? WHERE id=?", [
              JSON.stringify(items),
              run.id,
            ]);
          for (let i = run.delivered; i < items.length; i++) {
            const receipt = await this.hooks.send(items[i]!);
            this.store.db.transaction(() => {
              this.store.db.run("INSERT OR REPLACE INTO delivery_receipts VALUES(?,?,?)", [
                run.id,
                i,
                receipt,
              ]);
              this.store.db.run("UPDATE runs SET delivered=? WHERE id=?", [i + 1, run.id]);
            })();
          }
          this.store.db.run("UPDATE runs SET delivered=-1,delivery_error=NULL WHERE id=?", [
            run.id,
          ]);
        } catch (error) {
          this.store.db.run(
            "UPDATE runs SET attempts=attempts+1,next_delivery=?,delivery_error=? WHERE id=?",
            [
              Date.now() + Math.min(300_000, 5000 * 2 ** run.attempts),
              redactSecrets(String(error)),
              run.id,
            ],
          );
        }
      }
    } finally {
      this.delivering = false;
    }
  }
  stop(id: number): boolean {
    const abort = this.active.get(id);
    if (abort) abort.abort();
    else
      this.store.db.run(
        "UPDATE runs SET state='cancelled',activity='Cancelled' WHERE id=? AND state IN ('queued','steering')",
        [id],
      );
    return Boolean(abort);
  }
  async shutdown(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    for (const abort of this.active.values()) abort.abort();
    // Leave the database open until provider callbacks settle; unclean exit is recovered on startup.
    const deadline = Date.now() + 8000;
    while ((this.active.size || this.delivering) && Date.now() < deadline) await Bun.sleep(50);
  }
}

export async function executeShellTask(task: Task, signal: AbortSignal): Promise<Output | null> {
  const parsed = taskData.parse({ type: task.type, data: JSON.parse(task.data) });
  if (parsed.type === "agent") return null;
  if (parsed.type === "reminder") return { text: parsed.data.message };
  const commands =
    parsed.type === "bash"
      ? [["sh", "-c", parsed.data.command]]
      : parsed.data.targets.map((target) => ["pkill", "-f", "--", target]);
  for (const command of commands) {
    signal.throwIfAborted();
    const child = Bun.spawn(command, {
      stdout: "ignore",
      stderr: "ignore",
      detached: process.platform !== "win32",
    });
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        /* Already exited. */
      }
    };
    const abort = () => {
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 2000).unref();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const code = await child.exited;
      signal.throwIfAborted();
      if (code !== 0 && !(parsed.type === "cleanup" && code === 1))
        throw new Error(`Task ${task.name} exited with code ${code}`);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  return { text: "" };
}

export function addTask(
  name: string,
  type: TaskType,
  data: Record<string, unknown>,
  options?: { cron?: string; delayMs?: number; timezone?: string },
): Task {
  return getStore().add(name, type, data, options);
}
export function removeTask(name: string): void {
  getStore().cancelSchedule(name);
}
export function listTasks(): Task[] {
  return getStore()
    .db.query("SELECT * FROM tasks WHERE enabled=1 ORDER BY next_run")
    .all() as Task[];
}
export function shutdownTasks(): void {
  getStore().db.close();
}
