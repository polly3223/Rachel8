import { describe, expect, test } from "bun:test";
import { KeyedQueue } from "./keyed-queue.ts";

describe("KeyedQueue", () => {
  test("serializes work for the same key", async () => {
    const queue = new KeyedQueue<number>();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(1, async () => {
      events.push("first-start");
      await firstGate;
      events.push("first-end");
    });
    const second = queue.run(1, async () => {
      events.push("second-start");
    });

    await Bun.sleep(0);
    expect(events).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });

  test("continues after a failed task", async () => {
    const queue = new KeyedQueue<string>();
    const failed = queue.run("chat", async () => {
      throw new Error("failed");
    });
    const next = queue.run("chat", async () => "ok");

    await expect(failed).rejects.toThrow("failed");
    await expect(next).resolves.toBe("ok");
  });

  test("runs different keys concurrently", async () => {
    const queue = new KeyedQueue<number>();
    const started: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const one = queue.run(1, async () => {
      started.push(1);
      await gate;
    });
    const two = queue.run(2, async () => {
      started.push(2);
      await gate;
    });

    await Bun.sleep(0);
    expect(started).toEqual([1, 2]);
    release();
    await Promise.all([one, two]);
  });
});
