/**
 * SQLite-backed task scheduler for Rachel8.
 *
 * A polling loop checks for due tasks every 30 seconds.
 * Tasks can be added via the public API or directly via SQLite.
 *
 * Task types: "bash", "reminder", "cleanup", "agent"
 */

import { Database } from "bun:sqlite";
import { $ } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";
import { errorMessage } from "./errors.ts";

const MEMORY_DIR = join(env.SHARED_FOLDER_PATH, "rachel-memory");
const DB_PATH = join(MEMORY_DIR, "tasks.db");

if (!existsSync(MEMORY_DIR)) {
  mkdirSync(MEMORY_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");

const CREATE_TASKS_TABLE = `
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('bash', 'reminder', 'cleanup', 'agent')),
    data TEXT NOT NULL DEFAULT '{}',
    cron TEXT,
    next_run INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )
`;

// Migrate table if it lacks the 'agent' type constraint
const tableInfo = db.query("SELECT sql FROM sqlite_master WHERE name = 'tasks'").get() as { sql: string } | null;

if (tableInfo && !tableInfo.sql.includes("agent")) {
  db.exec("ALTER TABLE tasks RENAME TO tasks_old");
  db.exec(CREATE_TASKS_TABLE);
  db.exec("INSERT INTO tasks SELECT * FROM tasks_old");
  db.exec("DROP TABLE tasks_old");
  logger.info("Migrated tasks table to support 'agent' type");
} else if (!tableInfo) {
  db.exec(CREATE_TASKS_TABLE);
}

function parseCronField(field: string, max: number): number[] {
  if (field === "*") return Array.from({ length: max }, (_, i) => i);
  if (field.includes(",")) return field.split(",").map(Number);
  if (field.includes("/")) {
    const step = Number(field.split("/")[1]);
    return Array.from({ length: max }, (_, i) => i).filter(i => i % step === 0);
  }
  return [Number(field)];
}

function getNextCronRun(pattern: string, after: number = Date.now()): number {
  const parts = pattern.split(" ");
  const minPart = parts[0] ?? "*";
  const hourPart = parts[1] ?? "*";
  const domPart = parts[2] ?? "*";
  const monPart = parts[3] ?? "*";
  const dowPart = parts[4] ?? "*";

  const minutes = parseCronField(minPart, 60);
  const hours = parseCronField(hourPart, 24);
  const doms = parseCronField(domPart, 32).map(d => d || 1);
  const months = parseCronField(monPart, 13).map(m => m || 1);
  const dows = parseCronField(dowPart, 7);

  const start = new Date(after + 60000);
  start.setUTCSeconds(0, 0);

  const MAX_MINUTES_TO_SEARCH = 366 * 24 * 60;
  for (let i = 0; i < MAX_MINUTES_TO_SEARCH; i++) {
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

  return after + 3600000;
}

let sendTelegramMessage: ((text: string) => Promise<void>) | null = null;
let agentExecutor: ((prompt: string) => Promise<string>) | null = null;

export function setTelegramSender(
  sender: (text: string) => Promise<void>,
): void {
  sendTelegramMessage = sender;
}

export function setAgentExecutor(
  executor: (prompt: string) => Promise<string>,
): void {
  agentExecutor = executor;
}

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
          error: errorMessage(error),
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

    case "agent": {
      if (agentExecutor && sendTelegramMessage) {
        try {
          logger.info(`Agent task starting: ${task.name}`);
          const result = await agentExecutor(parsed.prompt);
          await sendTelegramMessage(result);
          logger.info(`Agent task completed: ${task.name}`);
        } catch (error) {
          logger.error(`Agent task failed: ${task.name}`, {
            error: errorMessage(error),
          });
          await sendTelegramMessage(
            `Agent task "${task.name}" failed: ${errorMessage(error)}`,
          );
        }
      } else {
        logger.warn("Cannot run agent task — executor or Telegram sender not configured");
      }
      break;
    }
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function pollTasks(): void {
  const now = Date.now();
  const dueTasks = db.query(
    "SELECT * FROM tasks WHERE enabled = 1 AND next_run <= ?",
  ).all(now) as TaskRow[];

  for (const task of dueTasks) {
    executeTask(task).catch((err) => {
      logger.error(`Task execution error: ${task.name}`, {
        error: errorMessage(err),
      });
    });

    if (task.cron) {
      const nextRun = getNextCronRun(task.cron, now);
      db.run("UPDATE tasks SET next_run = ? WHERE id = ?", [nextRun, task.id]);
      logger.debug(`Next run for ${task.name}: ${new Date(nextRun).toISOString()}`);
    } else {
      db.run("UPDATE tasks SET enabled = 0 WHERE id = ?", [task.id]);
    }
  }
}

export function startTaskPoller(): void {
  pollTasks();
  pollTimer = setInterval(pollTasks, 30_000);
  logger.info("Task poller started (30s interval)");
}

export function addTask(
  name: string,
  type: "bash" | "reminder" | "cleanup" | "agent",
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

export function shutdownTasks(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  db.close();
  logger.info("Task system shut down");
}

logger.info("Task system initialized (SQLite-backed scheduler)");
