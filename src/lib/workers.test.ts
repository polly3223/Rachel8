import { expect, test } from "bun:test";
import { join } from "node:path";
import { WorkStore, type Work } from "./work-store.ts";
import { WorkRunner } from "./tasks.ts";
import {
  dispatchWorkerMessages,
  getWorker,
  manageWorker,
  stopWorker,
  workerBoard,
  workerReviewInput,
  type Worker,
} from "./workers.ts";

function setup(path = ":memory:") {
  const store = new WorkStore(path);
  const chief = store.enqueue("telegram", "123456789", { messages: [] });
  store.claim("telegram");
  const act = (input: unknown) => manageWorker(store, chief.id, input);
  const start = (name = "alpha", maxTurns = 8) =>
    act({
      action: "start",
      name,
      prompt: `Inspect ${name}; no external actions`,
      maxTurns,
    }) as Worker & { runs: Work[] };
  return { store, chief, act, start };
}
const settle = () => Bun.sleep(15);

test("global queue capacity covers starts, messages and explicit recovery without orphan workers", () => {
  const { store, start, act } = setup();
  const failed = start("failed");
  store.finish(failed.runs[0]!.id, "failed", { text: "Paused" });
  const workers = Array.from({ length: 32 }, (_, i) => start(`job-${i}`));
  expect(() => start("overflow")).toThrow("queue is full");
  expect(store.db.query("SELECT count(*) AS n FROM workers").get()).toEqual({ n: 33 });
  expect(() =>
    act({ action: "message", id: workers[0]!.id, requestId: "next", message: "More" }),
  ).toThrow("queue is full");
  expect(() => store.resume(failed.runs[0]!.id)).toThrow("queue is full");
  expect(getWorker(store, failed.id)?.stopped).toBe(1);
});

test("failure to save a review rolls back worker completion rather than losing the handoff", () => {
  const { store, start } = setup();
  const worker = start();
  store.db.exec(
    "CREATE TRIGGER reject_review BEFORE INSERT ON worker_reports BEGIN SELECT RAISE(ABORT,'disk test'); END",
  );
  expect(() => store.finish(worker.runs[0]!.id, "succeeded", { text: "Evidence" })).toThrow(
    "disk test",
  );
  expect(store.get(worker.runs[0]!.id)?.result).toBeNull();
  expect(store.recent()).toHaveLength(2);
  store.db.exec("DROP TRIGGER reject_review");
  store.finish(worker.runs[0]!.id, "succeeded", { text: "Evidence" });
  expect(store.recent()).toHaveLength(3);
});

test("worker starts and addressed messages are idempotent, scoped and bounded", () => {
  const { store, chief, start, act } = setup();
  const worker = start();
  expect(start().id).toBe(worker.id);
  expect(store.recent()).toHaveLength(2);
  expect(() => act({ action: "start", name: "alpha", prompt: "Different scope" })).toThrow(
    "different brief",
  );
  const secondChief = store.enqueue("telegram", "987654321", {});
  store.claim("telegram");
  expect(() => manageWorker(store, secondChief.id, { action: "stop", id: worker.id })).toThrow(
    "does not belong",
  );
  expect(() =>
    manageWorker(store, worker.runs[0]!.id, { action: "start", name: "child", prompt: "x" }),
  ).toThrow("chief");
  const message = {
    action: "message",
    id: worker.id,
    requestId: "correction-1",
    message: "Only inspect files",
  };
  const first = act(message) as Work;
  expect(act(message)).toMatchObject({ id: first.id, duplicate: true });
  expect(() => act({ ...message, message: "Different" })).toThrow("requestId");
  store.finish(chief.id, "succeeded", { text: "Delegated" });
  expect(() => act({ action: "stop", id: worker.id })).toThrow("active chief");
});

test("two workers run while a new chief turn stays executable; per-worker turns serialize", async () => {
  const { store, chief, start, act } = setup();
  const a = start(),
    b = start("beta"),
    c = start("gamma");
  act({ action: "message", id: a.id, requestId: "next", message: "Follow-up" });
  await dispatchWorkerMessages(store, async () => false);
  store.finish(chief.id, "succeeded", { text: "" });
  const chat = store.enqueue("telegram", chief.key, {});
  const started: number[] = [];
  const runner = new WorkRunner(store, {
    owner: 123456789,
    send: async () => 1,
    execute: async (run, signal) => {
      started.push(run.id);
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Stopped")), { once: true }),
      );
    },
  });
  runner.tick();
  expect(started).toEqual([chat.id, a.runs[0]!.id, b.runs[0]!.id]);
  expect(store.get(c.runs[0]!.id)?.state).toBe("queued");
  expect(started).toHaveLength(3);
  await runner.shutdown();
});

test("completion is atomic, batched once and delivered through the original chief after it returns", async () => {
  const { store, chief, start } = setup();
  const a = start(),
    b = start("beta");
  store.finish(chief.id, "succeeded", { text: "" });
  for (const worker of [a, b])
    store.finish(worker.runs[0]!.id, "succeeded", {
      text: `Evidence ${worker.name}`,
      artifacts: ["/saved/file.txt"],
    });
  store.finish(a.runs[0]!.id, "succeeded", { text: "duplicate" });
  const reviews = store.recent().filter((r) => JSON.parse(r.body).workerReview);
  expect(reviews).toHaveLength(1);
  expect(reviews[0]!.key).toBe(chief.key);
  expect(workerReviewInput(store, reviews[0]!.id)).toContain("Evidence alpha");
  expect(workerReviewInput(store, reviews[0]!.id)).toContain("Evidence beta");
  expect(workerReviewInput(store, reviews[0]!.id)).not.toContain("duplicate");
  const sent: string[] = [];
  const runner = new WorkRunner(store, {
    owner: 123456789,
    execute: async () => ({ text: "" }),
    send: async (item) => {
      sent.push(item.text!);
      return 1;
    },
  });
  await runner.deliver();
  expect(sent).toEqual([]);
  store.finish(reviews[0]!.id, "succeeded", { text: "Reviewed both workers" });
  await runner.deliver();
  await runner.deliver();
  expect(sent).toEqual(["Reviewed both workers"]);
  await runner.shutdown();
});

test("a chief and its completion review cannot execute concurrently", () => {
  const { store, chief, start } = setup();
  const worker = start();
  store.finish(worker.runs[0]!.id, "succeeded", { text: "Done" });
  expect(store.claim("telegram")).toBeNull();
  store.finish(chief.id, "succeeded", { text: "Done" });
  expect(JSON.parse(store.claim("telegram")!.body).workerReview).toBe(true);
});

test("acknowledged steering is never executed as another turn or repeated", async () => {
  const { store, start, act } = setup();
  const worker = start();
  store.claim("task");
  const message = act({
    action: "message",
    id: worker.id,
    requestId: "one",
    message: "Corrected scope",
  }) as Work;
  const sent: string[] = [];
  const steer = async (key: string, text: string) => {
    sent.push(`${key}: ${text}`);
    return true;
  };
  await dispatchWorkerMessages(store, steer);
  await dispatchWorkerMessages(store, steer);
  expect(sent).toEqual([`worker:${worker.id}: Corrected scope`]);
  expect(store.get(message.id)?.state).toBe("steered");
  store.finish(worker.runs[0]!.id, "succeeded", { text: "Applied correction" });
  expect(store.claim("task")).toBeNull();
  expect(workerBoard(store, "123456789")[0]).toMatchObject({
    state: "succeeded",
    run_id: worker.runs[0]!.id,
  });
});

test("new follow-ups cannot overtake older queued instructions when steering becomes available", async () => {
  const { store, start, act } = setup();
  const worker = start();
  store.claim("task");
  const first = act({
    action: "message",
    id: worker.id,
    requestId: "one",
    message: "First",
  }) as Work;
  const second = act({
    action: "message",
    id: worker.id,
    requestId: "two",
    message: "Second",
  }) as Work;
  let calls = 0;
  await dispatchWorkerMessages(store, async () => ++calls > 1);
  expect(calls).toBe(1);
  expect(store.get(first.id)?.state).toBe("queued");
  expect(store.get(second.id)?.state).toBe("queued");
  store.finish(worker.runs[0]!.id, "succeeded", { text: "Initial done" });
  expect(store.claim("task")?.id).toBe(first.id);
  expect(store.claim("task")).toBeNull();
});

test("unavailable steering and a definitively ended turn become one queued follow-up", async () => {
  for (const steer of [
    async () => false,
    async () => {
      throw new Error("no active turn");
    },
  ]) {
    const { store, start, act } = setup();
    const worker = start();
    store.finish(worker.runs[0]!.id, "succeeded", { text: "Done" });
    const message = act({
      action: "message",
      id: worker.id,
      requestId: "one",
      message: "New bounded check",
    }) as Work;
    await dispatchWorkerMessages(store, steer);
    expect(store.claim("task")?.id).toBe(message.id);
    expect(store.claim("task")).toBeNull();
  }
});

test("ambiguous steering pauses the worker and cancels queued follow-ups, without replay", async () => {
  const { store, start, act } = setup();
  const worker = start();
  store.claim("task");
  const first = act({
    action: "message",
    id: worker.id,
    requestId: "one",
    message: "Correction",
  }) as Work;
  const second = act({
    action: "message",
    id: worker.id,
    requestId: "two",
    message: "Later",
  }) as Work;
  let calls = 0;
  await dispatchWorkerMessages(store, async () => {
    calls++;
    throw new Error("Timeout after send");
  });
  expect(calls).toBe(1);
  expect(store.get(first.id)?.state).toBe("interrupted");
  expect(store.get(second.id)?.state).toBe("cancelled");
  expect(getWorker(store, worker.id)?.stopped).toBe(1);
  expect(store.claim("task")).toBeNull();
});

test("stopping during an in-flight steer cannot resurrect a follow-up", async () => {
  const { store, start, act } = setup();
  const worker = start();
  store.claim("task");
  const message = act({
    action: "message",
    id: worker.id,
    requestId: "one",
    message: "Correction",
  }) as Work;
  let ack!: (sent: boolean) => void;
  const sending = dispatchWorkerMessages(
    store,
    () =>
      new Promise((resolve) => {
        ack = resolve;
      }),
  );
  stopWorker(store, worker.id);
  ack(true);
  await sending;
  expect(store.get(message.id)?.state).toBe("cancelled");
  expect(store.claim("task")).toBeNull();
});

test("stop aborts its worker and cancels its queue without stopping siblings", async () => {
  const { store, start, act } = setup();
  const a = start(),
    b = start("beta");
  const signals = new Map<number, AbortSignal>();
  const runner = new WorkRunner(store, {
    owner: 123456789,
    send: async () => 1,
    execute: async (run, signal) => {
      signals.set(run.id, signal);
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Stopped")), { once: true }),
      );
    },
  });
  runner.tick();
  const message = act({ action: "message", id: a.id, requestId: "one", message: "Later" }) as Work;
  runner.stop(a.runs[0]!.id);
  await settle();
  expect(signals.get(a.runs[0]!.id)?.aborted).toBe(true);
  expect(signals.get(b.runs[0]!.id)?.aborted).toBe(false);
  expect(store.get(message.id)?.state).toBe("cancelled");
  await runner.shutdown();
});

test("restart preserves completed handoffs and interrupts uncertain sends without repeating work", () => {
  const path = join(Bun.env["SHARED_FOLDER_PATH"]!, "workers-restart.db");
  const { store, start, act, chief } = setup(path);
  const a = start(),
    b = start("beta");
  store.finish(a.runs[0]!.id, "succeeded", { text: "Saved evidence" });
  store.claim("task");
  const message = act({
    action: "message",
    id: b.id,
    requestId: "one",
    message: "Correction",
  }) as Work;
  store.db.run("UPDATE runs SET state='steering' WHERE id=?", [message.id]);
  store.saveSession("codex", `worker:${b.id}`, "saved-session");
  store.finish(chief.id, "succeeded", { text: "" });
  store.db.close();
  const reopened = new WorkStore(path);
  reopened.recover();
  expect(reopened.session("codex", `worker:${b.id}`)).toBe("saved-session");
  expect(reopened.get(b.runs[0]!.id)?.state).toBe("interrupted");
  expect(reopened.get(message.id)?.state).not.toBe("queued");
  expect(reopened.claim("task")).toBeNull();
  expect(
    reopened.db.query("SELECT count(*) AS n FROM worker_reports WHERE run_id=?").get(a.runs[0]!.id),
  ).toEqual({ n: 1 });
  const resumed = reopened.resume(b.runs[0]!.id);
  expect(resumed.worker_id).toBe(b.id);
  expect(reopened.resume(b.runs[0]!.id).id).toBe(resumed.id);
  expect(reopened.claim("task")?.id).toBe(resumed.id);
  reopened.db.close();
});

test("resuming a failed chief review preserves reports and never restarts its worker", () => {
  const { store, chief, start } = setup();
  const a = start();
  store.finish(a.runs[0]!.id, "succeeded", { text: "Evidence retained" });
  store.finish(chief.id, "succeeded", { text: "" });
  const review = store.claim("telegram")!;
  store.finish(review.id, "failed", { text: "capacity" });
  const resumed = store.resume(review.id);
  expect(workerReviewInput(store, resumed.id)).toContain("Evidence retained");
  expect(store.claim("task")).toBeNull();
});

test("worker budget limits follow-ups and recovery; roster keeps old active work", () => {
  const { store, start, act } = setup();
  const a = start("bounded", 1);
  expect(() => act({ action: "message", id: a.id, requestId: "one", message: "More" })).toThrow(
    "turn limit",
  );
  for (let i = 0; i < 30; i++) {
    const noise = store.enqueue("telegram", "987654321", {});
    store.finish(noise.id, "succeeded", { text: "" });
  }
  expect(workerBoard(store, "123456789")).toHaveLength(1);
  expect(workerBoard(store, "987654321")).toEqual([]);
  store.finish(a.runs[0]!.id, "failed", { text: "capacity" });
  expect(() => store.resume(a.runs[0]!.id)).toThrow("turn limit");
});
