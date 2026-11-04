import { describe, expect, test } from "bun:test";

import { KeyedMutex } from "./KeyedMutex";

describe("KeyedMutex", () => {
  test("runs work for one key in call order", async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    let release: () => void = () => undefined;

    const first = mutex.run("a", async () => {
      await new Promise<void>((resolve) => (release = resolve));
      order.push("first");
    });
    const second = mutex.run("a", async () => {
      order.push("second");
    });
    const other = mutex.run("b", async () => {
      order.push("other key");
    });

    await other;
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["other key", "first", "second"]);
    expect(mutex.size).toBe(0);
  });

  test("releases the key when the work throws", async () => {
    const mutex = new KeyedMutex();

    await expect(
      mutex.run("a", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(mutex.size).toBe(0);
    expect(await mutex.run("a", async () => "next")).toBe("next");
    expect(mutex.size).toBe(0);
  });

  test("tryRun skips a busy key", async () => {
    const mutex = new KeyedMutex();
    let release: () => void = () => undefined;
    const held = mutex.run(
      "a",
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    expect(await mutex.tryRun("a", async () => "ran")).toBeNull();
    expect(await mutex.tryRun("b", async () => "ran")).toBe("ran");

    release();
    await held;
    expect(await mutex.tryRun("a", async () => "ran")).toBe("ran");
    expect(mutex.size).toBe(0);
  });
});
