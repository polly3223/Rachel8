/**
 * Quick script to schedule tasks from the command line.
 * Usage: bun run scripts/schedule.ts <action> [args]
 *
 * Writes to the same SQLite DB the main app uses, then restarts
 * Rachel8 so the worker picks up the new tasks.
 */

import { $ } from "bun";
import { scheduleRecurring, scheduleTask, removeRecurring, shutdownTasks } from "../src/lib/tasks.ts";

const [action, ...args] = process.argv.slice(2);

let needsRestart = false;

switch (action) {
  case "recurring": {
    const [name, pattern, type, message] = args;
    if (!name || !pattern || !type || !message) {
      console.error("Usage: bun run scripts/schedule.ts recurring <name> <cron> <type> <message>");
      process.exit(1);
    }
    await scheduleRecurring(name, { type: type as "reminder", message }, pattern);
    console.log(`Recurring task "${name}" scheduled with pattern "${pattern}"`);
    needsRestart = true;
    break;
  }

  case "remove": {
    const [name] = args;
    if (!name) {
      console.error("Usage: bun run scripts/schedule.ts remove <name>");
      process.exit(1);
    }
    await removeRecurring(name);
    console.log(`Recurring task "${name}" removed`);
    needsRestart = true;
    break;
  }

  case "once": {
    const [name, delayMs, type, message] = args;
    if (!name || !type || !message) {
      console.error("Usage: bun run scripts/schedule.ts once <name> <delayMs> <type> <message>");
      process.exit(1);
    }
    await scheduleTask(name, { type: type as "reminder", message }, {
      delay: delayMs ? Number(delayMs) : undefined,
    });
    console.log(`One-off task "${name}" scheduled`);
    needsRestart = true;
    break;
  }

  default:
    console.error("Unknown action. Use: recurring, remove, once");
    process.exit(1);
}

await shutdownTasks();

if (needsRestart) {
  console.log("Restarting Rachel8 to pick up new tasks...");
  await $`sudo systemctl restart rachel8`.quiet();
  console.log("Rachel8 restarted.");
}

process.exit(0);
