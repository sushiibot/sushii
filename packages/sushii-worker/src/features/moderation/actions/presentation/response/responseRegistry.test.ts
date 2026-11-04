import { sleep } from "bun";
import { describe, expect, mock, test } from "bun:test";

import { createActionResponseRegistry } from "./responseRegistry";

function entry(messageId: string, caseIds: string[], guildId = "1") {
  return {
    guildId,
    caseIds,
    messageId,
    markStale: mock(async () => undefined),
  };
}

describe("actionResponseRegistry", () => {
  test("marks responses that share a case, once", async () => {
    const registry = createActionResponseRegistry();
    const a = entry("10", ["4822", "4823"]);
    const b = entry("11", ["4830"]);
    const otherGuild = entry("12", ["4822"], "2");
    registry.register(a);
    registry.register(b);
    registry.register(otherGuild);

    await registry.markStale("1", ["4823"]);
    await registry.markStale("1", ["4823"]);

    expect(a.markStale).toHaveBeenCalledTimes(1);
    expect(b.markStale).not.toHaveBeenCalled();
    expect(otherGuild.markStale).not.toHaveBeenCalled();
  });

  test("skips the response the change came from, which stays registered", async () => {
    const registry = createActionResponseRegistry();
    const a = entry("10", ["4822"]);
    registry.register(a);

    await registry.markStale("1", ["4822"], { exceptMessageId: "10" });
    expect(a.markStale).not.toHaveBeenCalled();

    await registry.markStale("1", ["4822"]);
    expect(a.markStale).toHaveBeenCalledTimes(1);
  });

  test("never throws when a stale edit fails", async () => {
    const registry = createActionResponseRegistry();
    const failing = entry("10", ["4822"]);
    failing.markStale.mockImplementation(async () => {
      throw new Error("token expired");
    });
    const throwing = {
      ...entry("11", ["4822"]),
      markStale: () => {
        throw new Error("sync");
      },
    };
    const ok = entry("12", ["4822"]);
    registry.register(failing);
    registry.register(throwing);
    registry.register(ok);

    await registry.markStale("1", ["4822"]);
    expect(ok.markStale).toHaveBeenCalledTimes(1);
  });

  test("drops entries once the window has passed, or when unregistered", async () => {
    const registry = createActionResponseRegistry(5);
    const expired = entry("10", ["4822"]);
    const removed = entry("11", ["4823"]);
    registry.register(expired);
    registry.register(removed);
    registry.unregister(removed);

    await sleep(20);
    await registry.markStale("1", ["4822", "4823"]);
    expect(expired.markStale).not.toHaveBeenCalled();
    expect(removed.markStale).not.toHaveBeenCalled();
  });
});
