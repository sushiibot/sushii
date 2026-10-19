import { describe, expect, it } from "bun:test";

import { createNonOverlappingTaskRunner } from "./registerTasks";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createNonOverlappingTaskRunner", () => {
  it("skips a run while the previous run is still in progress", async () => {
    const gate = deferred();
    let calls = 0;

    const run = createNonOverlappingTaskRunner(
      {
        name: "test-task",
        onTick: async () => {
          calls++;
          await gate.promise;
        },
      },
      0,
    );

    const first = run();
    await run();
    await run();

    expect(calls).toBe(1);

    gate.resolve();
    await first;

    await run();
    expect(calls).toBe(2);
  });

  it("catches errors and allows subsequent runs", async () => {
    let calls = 0;

    const run = createNonOverlappingTaskRunner(
      {
        name: "failing-task",
        onTick: async () => {
          calls++;
          throw new Error("boom");
        },
      },
      0,
    );

    await expect(run()).resolves.toBeUndefined();
    await expect(run()).resolves.toBeUndefined();

    expect(calls).toBe(2);
  });
});
