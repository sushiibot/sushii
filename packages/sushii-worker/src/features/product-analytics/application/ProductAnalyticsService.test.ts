import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";

import type { ProductAnalyticsRepository } from "../domain/ProductAnalyticsRepository";
import { actorCode } from "../domain/ProductEvent";
import { ProductAnalyticsService } from "./ProductAnalyticsService";

const KEY = "k".repeat(32);

function setup(key: string | undefined, insert = mock(async () => undefined)) {
  const warn = mock();
  const service = new ProductAnalyticsService(
    { insert } as unknown as ProductAnalyticsRepository,
    key,
    { warn } as unknown as Logger,
  );
  return { service, insert, warn };
}

describe("ProductAnalyticsService", () => {
  test("stores a code, never the user ID", () => {
    const { service, insert } = setup(KEY);

    service.track({
      name: "prompt.shown",
      userId: "123456789012345678",
      guildId: "987654321098765432",
      props: { prompt: "follow_updates" },
    });

    expect(insert).toHaveBeenCalledWith({
      name: "prompt.shown",
      feature: "prompts",
      guildId: 987654321098765432n,
      actor: actorCode(KEY, "123456789012345678"),
      props: { prompt: "follow_updates" },
    });
  });

  test("records nothing without a key", () => {
    const { service, insert } = setup(undefined);

    service.track({ name: "update.relayed", userId: null, guildId: "1" });

    expect(insert).not.toHaveBeenCalled();
  });

  test("a failed insert doesn't reach the caller", async () => {
    const insert = mock(async () => {
      throw new Error("db down");
    });
    const { service, warn } = setup(KEY, insert);

    service.track({ name: "update.relayed", userId: null, guildId: "1" });
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("drops events while too many inserts are pending", () => {
    const insert = mock(() => new Promise<undefined>(() => undefined));
    const { service } = setup(KEY, insert);

    for (let i = 0; i < 150; i += 1) {
      service.track({ name: "update.relayed", userId: null, guildId: "1" });
    }

    expect(insert).toHaveBeenCalledTimes(100);
  });

  test("refuses a deletion it can't complete", async () => {
    const { service } = setup(undefined);

    await expect(service.deleteUserData("1")).rejects.toThrow(
      "PRODUCT_ANALYTICS_KEY",
    );
  });

  test("the same user gets a different code under a different key", () => {
    expect(actorCode(KEY, "1").equals(actorCode("j".repeat(32), "1"))).toBe(
      false,
    );
    expect(actorCode(KEY, "1").length).toBe(16);
  });
});
