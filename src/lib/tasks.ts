/**
 * Task scheduling system for Rachel8
 *
 * Uses bunqueue in embedded mode (SQLite-backed, no Redis needed).
 * Allows Rachel to schedule one-off delayed tasks and recurring cron jobs.
 *
 * Task types:
 * - "bash": Run a shell command
 * - "reminder": Send a Telegram message to Lorenzo
 * - "cleanup": Clean up temporary files/processes
 */

import { Queue, Worker } from "bunqueue/client";
import { $ } from "bun";
import { logger } from "./logger.ts";

const DATA_DIR = `${import.meta.dir}/../../data`;
const DB_PATH = `${DATA_DIR}/tasks.db`;

// Ensure data directory exists
import { mkdirSync, existsSync } from "node:fs";
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// bunqueue reads this as the SQLite file path
process.env.DATA_PATH = DB_PATH;

// -- Types --------------------------------------------------------------------

interface BashTaskData {
  type: "bash";
  command: string;
  description?: string;
}

interface ReminderTaskData {
  type: "reminder";
  message: string;
}

interface CleanupTaskData {
  type: "cleanup";
  targets: string[]; // process names or paths to clean
}

type TaskData = BashTaskData | ReminderTaskData | CleanupTaskData;

// -- Telegram sender (set at init) --------------------------------------------

let sendTelegramMessage: ((text: string) => Promise<void>) | null = null;

export function setTelegramSender(
  sender: (text: string) => Promise<void>,
): void {
  sendTelegramMessage = sender;
}

// -- Queue & Worker -----------------------------------------------------------

export const taskQueue = new Queue("rachel-tasks", { embedded: true });

const worker = new Worker(
  "rachel-tasks",
  async (job) => {
    const data = job.data as TaskData;
    logger.info(`Processing task: ${job.name}`, { type: data.type });

    switch (data.type) {
      case "bash": {
        try {
          const result = await $`sh -c ${data.command}`.text();
          logger.info(`Bash task completed: ${data.description ?? data.command}`, {
            output: result.slice(0, 500),
          });
        } catch (error) {
          logger.error(`Bash task failed: ${data.command}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      case "reminder": {
        if (sendTelegramMessage) {
          await sendTelegramMessage(data.message);
          logger.info(`Reminder sent: ${data.message.slice(0, 100)}`);
        } else {
          logger.warn("Cannot send reminder — Telegram sender not configured");
        }
        break;
      }

      case "cleanup": {
        for (const target of data.targets) {
          try {
            await $`pkill -f ${target}`.quiet();
            logger.info(`Cleaned up process: ${target}`);
          } catch {
            logger.debug(`Nothing to clean up for: ${target}`);
          }
        }
        break;
      }

      default:
        logger.warn(`Unknown task type`, { data });
    }
  },
  { embedded: true },
);

// -- Public API ---------------------------------------------------------------

/** Schedule a one-off task with optional delay in milliseconds */
export async function scheduleTask(
  name: string,
  data: TaskData,
  options?: { delay?: number },
): Promise<void> {
  await taskQueue.add(name, data, {
    delay: options?.delay,
  });
  logger.info(`Task scheduled: ${name}`, {
    type: data.type,
    delay: options?.delay,
  });
}

/** Schedule a recurring task with a cron pattern */
export async function scheduleRecurring(
  name: string,
  data: TaskData,
  pattern: string,
): Promise<void> {
  await taskQueue.upsertJobScheduler(name, { pattern }, {
    name,
    data,
  });
  logger.info(`Recurring task scheduled: ${name}`, { pattern });
}

/** Remove a recurring task scheduler */
export async function removeRecurring(name: string): Promise<void> {
  await taskQueue.removeJobScheduler(name);
  logger.info(`Recurring task removed: ${name}`);
}

/** Graceful shutdown */
export async function shutdownTasks(): Promise<void> {
  await worker.close();
  await taskQueue.close();
  logger.info("Task system shut down");
}

logger.info("Task system initialized (bunqueue embedded mode)");
