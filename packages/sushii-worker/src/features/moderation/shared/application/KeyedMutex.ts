/** Runs async work one at a time per key, in call order. In-process only. */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  /** Runs fn only if nothing holds the key; null when it's busy. */
  async tryRun<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    if (this.tails.has(key)) {
      return null;
    }

    return this.run(key, fn);
  }

  /** Keys currently held or waited on. */
  get size(): number {
    return this.tails.size;
  }

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => done);
    this.tails.set(key, tail);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }
}
