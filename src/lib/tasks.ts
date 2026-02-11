/**
 * Task scheduling system for Rachel8
 *
 * Simple SQLite-backed scheduler. No external dependencies.
 * A polling loop checks for due tasks every 30 seconds.
 *
 * Tasks can be added/removed by writing to the SQLite DB from anywhere
 * (Bash, scripts, etc.) — the running process picks them up automatically.
 *
 * Task types:
 * - "bash": Run a shell command
 * - "reminder": Send a Telegram message to Lorenzo
 * - "cleanup": Kill processes by name
 */

import { Database } from "bun:sqlite";
import { $ } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";

// -- Database setup -----------------------------------------------------------

const MEMORY_DIR = join(env.SHARED_FOLDER_PATH, "rachel-memory");
const DB_PATH = join(MEMORY_DIR, "tasks.db");

if (!existsSync(MEMORY_DIR)) {
  mkdirSync(MEMORY_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('bash', 'reminder', 'cleanup')),
    data TEXT NOT NULL DEFAULT '{}',
    cron TEXT,
    next_run INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )
`);

// -- Cron parsing -------------------------------------------------------------

/** Parse a simple cron pattern (minute hour dom month dow) into next run time */
function getNextCronRun(pattern: string, after: number = Date.now()): number {
  const [minPart, hourPart, domPart, monPart, dowPart] = pattern.split(" ");

  const parseField = (field: string, max: number): number[] => {
    if (field === "*") return Array.from({ length: max }, (_, i) => i);
    if (field.includes(",")) return field.split(",").map(Number);
    if (field.includes("/")) {
      const [, step] = field.split("/");
      return Array.from({ length: max }, (_, i) => i).filter(i => i % Number(step) === 0);
    }
    return [Number(field)];
  };

  const minutes = parseField(minPart, 60);
  const hours = parseField(hourPart, 24);
  const doms = parseField(domPart, 32).map(d => d || 1); // day of month 1-31
  const months = parseField(monPart, 13).map(m => m || 1); // month 1-12
  const dows = parseField(dowPart, 7); // day of week 0-6

  const start = new Date(after + 60000); // at least 1 minute from now
  start.setUTCSeconds(0, 0);

  // Search up to 366 days ahead
  for (let i = 0; i < 527040; i++) { // 366 * 24 * 60
    const candidate = new Date(start.getTime() + i * 60000);
    const m = candidate.getUTCMinutes();
    const h = candidate.getUTCHours();
    const dom = candidate.getUTCDate();
    const mon = candidate.getUTCMonth() + 1;
    const dow = candidate.getUTCDay();

    if (
      minutes.includes(m) &&
      hours.includes(h) &&
      (domPart === "*" || doms.includes(dom)) &&
      (monPart === "*" || months.includes(mon)) &&
      (dowPart === "*" || dows.includes(dow))
    ) {
      return candidate.getTime();
    }
  }

  // Fallback: 1 hour from now
  return after + 3600000;
}

// -- Telegram sender ----------------------------------------------------------

let sendTelegramMessage: ((text: string) => Promise<void>) | null = null;

export function setTelegramSender(
  sender: (text: string) => Promise<void>,
): void {
  sendTelegramMessage = sender;
}

// -- Task execution -----------------------------------------------------------

interface TaskRow {
  id: number;
  name: string;
  type: string;
  data: string;
  cron: string | null;
  next_run: number;
  enabled: number;
}

async function executeTask(task: TaskRow): Promise<void> {
  const parsed = JSON.parse(task.data);
  logger.info(`Executing task: ${task.name}`, { type: task.type });

  switch (task.type) {
    case "bash": {
      try {
        const result = await $`sh -c ${parsed.command}`.text();
        logger.info(`Bash task done: ${task.name}`, { output: result.slice(0, 500) });
      } catch (error) {
        logger.error(`Bash task failed: ${task.name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }

    case "reminder": {
      if (sendTelegramMessage) {
        await sendTelegramMessage(parsed.message);
        logger.info(`Reminder sent: ${task.name}`);
      } else {
        logger.warn("Cannot send reminder — Telegram sender not configured");
      }
      break;
    }

    case "cleanup": {
      const targets: string[] = parsed.targets ?? [];
      for (const target of targets) {
        try {
          await $`pkill -f ${target}`.quiet();
          logger.info(`Cleaned up: ${target}`);
        } catch {
          logger.debug(`Nothing to clean for: ${target}`);
        }
      }
      break;
    }
  }
}

// -- Polling loop -------------------------------------------------------------

let pollTimer: ReturnType<typeof setInterval> | null = null;

function pollTasks(): void {
  const now = Date.now();
  const dueTasks = db.query(
    "SELECT * FROM tasks WHERE enabled = 1 AND next_run <= ?",
  ).all(now) as TaskRow[];

  for (const task of dueTasks) {
    // Fire and forget — don't block the poll loop
    executeTask(task).catch((err) => {
      logger.error(`Task execution error: ${task.name}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    if (task.cron) {
      // Recurring: schedule next run
      const nextRun = getNextCronRun(task.cron, now);
      db.run("UPDATE tasks SET next_run = ? WHERE id = ?", [nextRun, task.id]);
      logger.debug(`Next run for ${task.name}: ${new Date(nextRun).toISOString()}`);
    } else {
      // One-off: disable after execution
      db.run("UPDATE tasks SET enabled = 0 WHERE id = ?", [task.id]);
    }
  }
}

export function startTaskPoller(): void {
  // Poll immediately on startup, then every 30 seconds
  pollTasks();
  pollTimer = setInterval(pollTasks, 30_000);
  logger.info("Task poller started (30s interval)");
}

// -- Public API (for use from scripts) ----------------------------------------

export function addTask(
  name: string,
  type: "bash" | "reminder" | "cleanup",
  data: Record<string, unknown>,
  options?: { cron?: string; delayMs?: number },
): void {
  const nextRun = options?.cron
    ? getNextCronRun(options.cron)
    : Date.now() + (options?.delayMs ?? 0);

  db.run(
    "INSERT INTO tasks (name, type, data, cron, next_run) VALUES (?, ?, ?, ?, ?)",
    [name, type, JSON.stringify(data), options?.cron ?? null, nextRun],
  );
  logger.info(`Task added: ${name}`, { type, cron: options?.cron, nextRun: new Date(nextRun).toISOString() });
}

export function removeTask(name: string): void {
  db.run("DELETE FROM tasks WHERE name = ?", [name]);
  logger.info(`Task removed: ${name}`);
}

export function listTasks(): TaskRow[] {
  return db.query("SELECT * FROM tasks WHERE enabled = 1 ORDER BY next_run").all() as TaskRow[];
}

// -- Shutdown -----------------------------------------------------------------

export function shutdownTasks(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  db.close();
  logger.info("Task system shut down");
}

logger.info("Task system initialized (SQLite-backed scheduler)");
