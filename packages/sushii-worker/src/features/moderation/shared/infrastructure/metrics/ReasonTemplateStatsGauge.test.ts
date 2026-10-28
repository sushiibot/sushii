import type { Meter, ObservableCallback } from "@opentelemetry/api";
import { describe, expect, mock, test } from "bun:test";
import type pino from "pino";

import {
  REASON_TEMPLATE_STATS_TTL_MS,
  ReasonTemplateStatsGauge,
} from "./ReasonTemplateStatsGauge";

function setup(countStats: ReturnType<typeof mock>, timeoutMs?: number) {
  const callbacks = new Map<string, ObservableCallback>();
  const meter = {
    createObservableGauge: (name: string) => ({
      addCallback: (cb: ObservableCallback) => callbacks.set(name, cb),
    }),
  } as unknown as Meter;
  let now = 1_000_000;
  const warn = mock();
  const logger = { warn } as unknown as pino.Logger;

  const gauge = new ReasonTemplateStatsGauge(
    { countStats },
    logger,
    meter,
    () => now,
    timeoutMs,
  );

  function collect(): Record<string, number[]> {
    const observed: Record<string, number[]> = {};
    for (const [name, cb] of callbacks) {
      observed[name] = [];
      void cb({ observe: (value: number) => observed[name].push(value) });
    }
    return observed;
  }

  return {
    gauge,
    collect,
    warn,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("ReasonTemplateStatsGauge", () => {
  test("queries nothing until collected and reports no value before the first load", () => {
    const countStats = mock(async () => ({ guilds: 2, total: 7 }));
    const { collect } = setup(countStats);

    expect(countStats).not.toHaveBeenCalled();
    expect(collect()).toEqual({
      "moderation.reason_template.guilds": [],
      "moderation.reason_template.total": [],
    });
    expect(countStats).toHaveBeenCalledTimes(1);
  });

  test("reports the cached value and refreshes at most once per TTL", async () => {
    const countStats = mock(async () => ({ guilds: 2, total: 7 }));
    const { gauge, collect, advance } = setup(countStats);

    await gauge.refreshIfStale();
    expect(collect()).toEqual({
      "moderation.reason_template.guilds": [2],
      "moderation.reason_template.total": [7],
    });

    advance(REASON_TEMPLATE_STATS_TTL_MS - 1);
    collect();
    expect(countStats).toHaveBeenCalledTimes(1);

    countStats.mockImplementation(async () => ({ guilds: 3, total: 9 }));
    advance(1);
    await gauge.refreshIfStale();
    expect(countStats).toHaveBeenCalledTimes(2);
    expect(collect()["moderation.reason_template.total"]).toEqual([9]);
  });

  test("a failed refresh warns, keeps the last value and waits a full TTL", async () => {
    const countStats = mock(async () => ({ guilds: 2, total: 7 }));
    const { gauge, collect, warn, advance } = setup(countStats);
    await gauge.refreshIfStale();

    countStats.mockImplementation(async () => {
      throw new Error("db down");
    });
    advance(REASON_TEMPLATE_STATS_TTL_MS);
    await gauge.refreshIfStale();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(collect()).toEqual({
      "moderation.reason_template.guilds": [2],
      "moderation.reason_template.total": [7],
    });
    expect(countStats).toHaveBeenCalledTimes(2);
  });

  test("a hung query times out, warns and frees the next refresh", async () => {
    const countStats = mock(async () => ({ guilds: 2, total: 7 }));
    const { gauge, collect, warn, advance } = setup(countStats, 5);
    await gauge.refreshIfStale();

    countStats.mockImplementation(() => new Promise(() => undefined));
    advance(REASON_TEMPLATE_STATS_TTL_MS);
    await gauge.refreshIfStale();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(collect()["moderation.reason_template.total"]).toEqual([7]);

    countStats.mockImplementation(async () => ({ guilds: 3, total: 9 }));
    advance(REASON_TEMPLATE_STATS_TTL_MS);
    await gauge.refreshIfStale();
    expect(collect()["moderation.reason_template.total"]).toEqual([9]);
  });
});
