/**
 * Schedule tasks from the command line.
 * The running Rachel8 process polls the DB every 30s and picks them up.
 * No restart needed!
 *
 * Usage:
 *   bun run scripts/schedule.ts add <name> <type> <data-json> [--cron "pattern"] [--delay ms]
 *   bun run scripts/schedule.ts remove <name>
 *   bun run scripts/schedule.ts list
 */

import { addTask, removeTask, listTasks, shutdownTasks } from "../src/lib/tasks.ts";

const [action, ...args] = process.argv.slice(2);

switch (action) {
  case "add": {
    const name = args[0];
    const type = args[1] as "bash" | "reminder" | "cleanup";
    const dataJson = args[2];

    if (!name || !type || !dataJson) {
      console.error('Usage: bun run scripts/schedule.ts add <name> <type> \'{"key":"val"}\' [--cron "* * * * *"] [--delay 5000]');
      process.exit(1);
    }

    const data = JSON.parse(dataJson);
    const cronIdx = args.indexOf("--cron");
    const delayIdx = args.indexOf("--delay");
    const cron = cronIdx >= 0 ? args[cronIdx + 1] : undefined;
    const delayMs = delayIdx >= 0 ? Number(args[delayIdx + 1]) : undefined;

    addTask(name, type, data, { cron, delayMs });
    console.log(`Task "${name}" added. The running process will pick it up within 30s.`);
    break;
  }

  case "remove": {
    const name = args[0];
    if (!name) {
      console.error("Usage: bun run scripts/schedule.ts remove <name>");
      process.exit(1);
    }
    removeTask(name);
    console.log(`Task "${name}" removed.`);
    break;
  }

  case "list": {
    const tasks = listTasks();
    if (tasks.length === 0) {
      console.log("No active tasks.");
    } else {
      for (const t of tasks) {
        const next = new Date(t.next_run).toISOString();
        console.log(`  ${t.name} [${t.type}] cron=${t.cron ?? "none"} next=${next}`);
      }
    }
    break;
  }

  default:
    console.error("Usage: add | remove | list");
    process.exit(1);
}

shutdownTasks();
