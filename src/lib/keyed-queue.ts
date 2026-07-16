export class KeyedQueue<Key> {
  private readonly tails = new Map<Key, Promise<void>>();

  async run<Result>(key: Key, task: () => Promise<Result>): Promise<Result> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.then(() => undefined, () => undefined);
    this.tails.set(key, tail);

    try {
      return await run;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
