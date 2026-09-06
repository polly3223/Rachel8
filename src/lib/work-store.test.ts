import { describe, test, expect } from "bun:test";
import { WorkStore, nextCron } from "./work-store.ts";
import { WorkRunner, executeShellTask } from "./tasks.ts";
import { Database } from "bun:sqlite";
import { join } from "node:path";

const fresh = () => new WorkStore(":memory:");
const tick = () => new Promise((r) => setTimeout(r, 10));
describe("durable work", () => {
  test("stopping queued work leaves its running sibling intact; shutdown records interruption", async () => {
    const store = fresh();
    const first = store.enqueue("telegram", "owner", {}),
      second = store.enqueue("telegram", "owner", {});
    let activeSignal: AbortSignal | undefined;
    const runner = new WorkRunner(store, {
      owner: 123456789,
      send: async () => 1,
      execute: async (_run, signal) => {
        activeSignal = signal;
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
        );
      },
    });
    runner.tick();
    runner.stop(second.id);
    expect(activeSignal?.aborted).toBe(false);
    expect(store.get(second.id)?.state).toBe("cancelled");
    await runner.shutdown();
    expect(store.get(first.id)?.state).toBe("interrupted");
  });
  test("pre-agent task constraints migrate without losing reminders", () => {
    const path = `${Bun.env["SHARED_FOLDER_PATH"]}/pre-agent.db`;
    const db = new Database(path);
    db.exec(
      "CREATE TABLE tasks(id INTEGER PRIMARY KEY,name TEXT,type TEXT CHECK(type IN ('bash','reminder','cleanup')),data TEXT,cron TEXT,next_run INTEGER,enabled INTEGER DEFAULT 1); INSERT INTO tasks VALUES(1,'saved','reminder','{}',NULL,123,1)",
    );
    db.close();
    const store = new WorkStore(path);
    store.add("agent", "agent", { prompt: "Hello" });
    expect(store.db.query("SELECT name FROM tasks ORDER BY id").all()).toEqual([
      { name: "saved" },
      { name: "agent" },
    ]);
    store.db.close();
  });
  test("migration preserves legacy rows and UTC schedules", () => {
    const path = join(Bun.env["SHARED_FOLDER_PATH"]!, "legacy.db");
    const db = new Database(path);
    db.exec(
      "CREATE TABLE tasks(id INTEGER PRIMARY KEY,name TEXT,type TEXT,data TEXT,cron TEXT,next_run INTEGER,enabled INTEGER); INSERT INTO tasks VALUES(5,'legacy','reminder','{\"message\":\"hello\"}','0 9 * * *',123,1)",
    );
    db.close();
    const store = new WorkStore(path);
    expect(store.db.query("SELECT id,next_run,timezone FROM tasks").get()).toEqual({
      id: 5,
      next_run: 123,
      timezone: "UTC",
    });
  });
  test("session rows survive concurrent conversations and reload", async () => {
    const path = join(Bun.env["SHARED_FOLDER_PATH"]!, "sessions.db");
    const store = new WorkStore(path);
    await Promise.all(
      Array.from({ length: 30 }, async (_, i) => {
        await Bun.sleep(i % 3);
        store.saveSession("codex", String(i), `thread-${i}`);
      }),
    );
    store.db.close();
    const reload = new WorkStore(path);
    for (let i = 0; i < 30; i++) expect(reload.session("codex", String(i))).toBe(`thread-${i}`);
    reload.saveSession("codex", "0", "fresh");
    expect(reload.db.query("SELECT previous_id FROM sessions WHERE key='0'").get()).toEqual({
      previous_id: "thread-0",
    });
  });
  test("one-off work remains durable after its schedule is disabled", () => {
    const store = fresh();
    store.add("job", "agent", { prompt: "continue", context: "project" });
    store.due();
    const run = store.claim()!;
    expect(store.get(run.id)?.state).toBe("running");
    store.recover();
    expect(store.get(run.id)?.state).toBe("interrupted");
    expect(store.claim()).toBeNull();
    expect(store.resume(run.id).body).toContain('"resumeOf":1');
    expect(store.resume(run.id).id).toBe(2);
    expect(store.recent()).toHaveLength(2);
  });
  test("later messages wait for an earlier album to finish collecting", () => {
    const store = fresh(),
      now = Date.now();
    const album = store.enqueue("telegram", "owner", {}, null, now + 1200);
    store.enqueue("telegram", "owner", {});
    expect(store.claim("telegram", now + 500)).toBeNull();
    expect(store.claim("telegram", now + 1500)?.id).toBe(album.id);
  });
  test("restart retains completed chunks and only sends the remaining saved result", async () => {
    const path = `${Bun.env["SHARED_FOLDER_PATH"]}/delivery-restart.db`;
    const original = new WorkStore(path),
      run = original.enqueue("telegram", "123456789", {});
    original.finish(run.id, "succeeded", { text: "unused" });
    original.db.run("UPDATE runs SET delivery=?,delivered=1 WHERE id=?", [
      JSON.stringify([
        { chat: 123456789, text: "first" },
        { chat: 123456789, text: "second" },
      ]),
      run.id,
    ]);
    original.db.close();
    const reopened = new WorkStore(path),
      sent: string[] = [];
    const runner = new WorkRunner(reopened, {
      owner: 123456789,
      execute: async () => {
        throw new Error("Must not execute");
      },
      send: async (item) => {
        sent.push(item.text!);
        return 73;
      },
    });
    reopened.recover();
    await runner.deliver();
    expect(sent).toEqual(["second"]);
    expect(reopened.db.query("SELECT message_id FROM delivery_receipts").get()).toEqual({
      message_id: 73,
    });
    await runner.shutdown();
    reopened.db.close();
  });
  test("cancelling a shell task terminates its child process group", async () => {
    const path = `${Bun.env["SHARED_FOLDER_PATH"]}/must-not-exist`;
    const ready = `${path}-ready`;
    const task = fresh().add("shell", "bash", {
      command: `touch '${ready}'; (sleep 0.4; touch '${path}') & wait`,
    });
    const controller = new AbortController();
    const work = executeShellTask(task, controller.signal);
    void work.catch(() => {});
    for (let i = 0; i < 50 && !(await Bun.file(ready).exists()); i++) await Bun.sleep(5);
    controller.abort();
    await expect(work).rejects.toThrow();
    await Bun.sleep(500);
    expect(await Bun.file(path).exists()).toBe(false);
  });
  test("overlapping recurring jobs and shared contexts do not execute concurrently", () => {
    const store = fresh();
    const task = store.add(
      "cron",
      "agent",
      { prompt: "work", context: "same" },
      { cron: "* * * * *" },
    );
    store.due(task.next_run);
    const first = store.claim(undefined, task.next_run)!;
    store.due(task.next_run + 600_000);
    expect(store.recent()).toHaveLength(1);
    store.enqueue("task", first.key, {});
    expect(store.claim(undefined, task.next_run + 600_000)).toBeNull();
    store.finish(first.id, "succeeded", { text: "done" });
    expect(store.claim(undefined, task.next_run + 600_000)).not.toBeNull();
  });
  test("delivery failure resumes at the unsent chunk without rerunning execution", async () => {
    const store = fresh();
    store.enqueue("telegram", "123456789", {});
    let executions = 0,
      sends = 0;
    const delivered: string[] = [];
    const runner = new WorkRunner(store, {
      owner: 123456789,
      execute: async () => {
        executions++;
        return { text: "A".repeat(7000) };
      },
      send: async (item) => {
        sends++;
        if (sends === 2) throw new Error("network down");
        delivered.push(item.text!);
        return sends;
      },
    });
    runner.tick();
    await tick();
    await runner.deliver();
    expect(store.get(1)?.delivered).toBe(1);
    expect(store.get(1)?.attempts).toBe(1);
    store.db.run("UPDATE runs SET next_delivery=0");
    await runner.deliver();
    expect(executions).toBe(1);
    expect(sends).toBe(3);
    expect(delivered.join("")).toBe("A".repeat(7000));
    expect(store.get(1)?.delivered).toBe(-1);
    await runner.shutdown();
  });
  test("capacity failures are recorded without automatic model or execution retries", async () => {
    const store = fresh();
    store.enqueue("telegram", "123456789", {});
    let calls = 0;
    const runner = new WorkRunner(store, {
      owner: 123456789,
      execute: async () => {
        calls++;
        throw new Error("Selected model is at capacity");
      },
      send: async () => 1,
    });
    runner.tick();
    await tick();
    runner.tick();
    await tick();
    expect(calls).toBe(1);
    expect(store.get(1)?.state).toBe("failed");
    await runner.shutdown();
  });
});
describe("schedules", () => {
  test("weekday ranges and cron day OR semantics", () => {
    const after = Date.parse("2026-09-06T16:43:00Z");
    expect(new Date(nextCron("0 9 * * 1-5", "UTC", after)).toISOString()).toBe(
      "2026-09-07T09:00:00.000Z",
    );
    expect(nextCron("0 9 1 * 1", "UTC", after)).toBe(nextCron("0 9 * * 1", "UTC", after));
  });
  test("Rome keeps the same local hour across daylight saving changes", () => {
    expect(
      new Date(
        nextCron("0 9 * * *", "Europe/Rome", Date.parse("2026-10-24T08:00:00Z")),
      ).toISOString(),
    ).toBe("2026-10-25T08:00:00.000Z");
    expect(
      new Date(
        nextCron("0 9 * * *", "Europe/Rome", Date.parse("2026-07-24T08:00:00Z")),
      ).toISOString(),
    ).toBe("2026-07-25T07:00:00.000Z");
  });
  test("invalid input cannot silently schedule a different time", () => {
    expect(() => nextCron("garbage", "UTC")).toThrow();
    expect(() => nextCron("0 9 * * *", "Bad/Zone")).toThrow();
    expect(() => fresh().add("job", "agent", { prompt: "x", context: "Invalid Slug" })).toThrow();
  });
});
