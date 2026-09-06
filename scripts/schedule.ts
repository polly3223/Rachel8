import { addTask, removeTask, listTasks } from "../src/lib/tasks.ts";
import { getStore } from "../src/ai/session-store.ts";
import type { TaskType } from "../src/lib/work-store.ts";
import { redactSecrets } from "../src/lib/memory.ts";

const [action, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
};
switch (action) {
  case "add": {
    const [name, type, data] = args;
    if (!name || !type || !data)
      throw new Error(
        "Usage: add <name> <type> <data-json> [--cron pattern] [--timezone Europe/Rome] [--delay ms]",
      );
    const task = addTask(name, type as TaskType, JSON.parse(data), {
      cron: flag("--cron"),
      timezone: flag("--timezone"),
      delayMs: flag("--delay") === undefined ? undefined : Number(flag("--delay")),
    });
    console.log(
      JSON.stringify({
        ...task,
        data: undefined,
        next: new Date(task.next_run).toLocaleString("en-GB", { timeZone: task.timezone }),
        timezone: task.timezone,
      }),
    );
    break;
  }
  case "remove":
    if (!args[0]) throw new Error("Task name required");
    removeTask(args[0]);
    console.log("Schedule and its queued runs cancelled.");
    break;
  case "list":
    console.log(
      JSON.stringify(
        listTasks().map(({ data: _, ...task }) => task),
        null,
        2,
      ),
    );
    break;
  case "runs":
    console.log(
      JSON.stringify(
        getStore()
          .recent(20)
          .map(({ body: _, ...run }) => run),
        null,
        2,
      ),
    );
    break;
  case "checkpoint": {
    const id = Number(args[0]);
    if (!Number.isSafeInteger(id) || !getStore().get(id)) throw new Error("Valid work ID required");
    const text = args.slice(1).join(" ");
    if (!text || text.length > 16000)
      throw new Error("Provide a concise checkpoint (at most 16000 characters)");
    getStore().db.run("UPDATE runs SET checkpoint=? WHERE id=?", [redactSecrets(text), id]);
    console.log(`Checkpoint saved for #${id}.`);
    break;
  }
  default:
    throw new Error("Usage: add | remove | list | runs | checkpoint");
}
