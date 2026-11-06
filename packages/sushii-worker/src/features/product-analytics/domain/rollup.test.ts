import { describe, expect, test } from "bun:test";

import {
  firstCompleteWeek,
  isReportedRetention,
  rawCutoff,
  startOfWeek,
  suppressRetention,
  suppressUsage,
} from "./rollup";

const week = new Date("2026-11-02T00:00:00.000Z");

describe("startOfWeek", () => {
  test("returns Monday 00:00 UTC", () => {
    expect(startOfWeek(new Date("2026-11-08T23:59:59.000Z"))).toEqual(week);
    expect(startOfWeek(new Date("2026-11-02T00:00:00.000Z"))).toEqual(week);
  });
});

describe("firstCompleteWeek", () => {
  test("is never before the raw cutoff", () => {
    const now = new Date("2026-11-06T12:00:00.000Z");
    const first = firstCompleteWeek(now);
    expect(first.getTime()).toBeGreaterThanOrEqual(rawCutoff(now).getTime());
    expect(first.getUTCDay()).toBe(1);
  });
});

describe("suppressUsage", () => {
  const counts = { week, guilds: 10, actors: 10, events: 50 };

  test("tests a user feature on actors", () => {
    expect(
      suppressUsage({ ...counts, feature: "social", actors: 4 }),
    ).toBeNull();
  });

  test("tests a guild feature on guilds and nulls the other count", () => {
    expect(
      suppressUsage({ ...counts, feature: "sushii-updates", actors: 0 }),
    ).toEqual({ ...counts, feature: "sushii-updates", actors: null });
    expect(
      suppressUsage({ ...counts, feature: "moderation", guilds: 4 }),
    ).toBeNull();
  });

  test("tests all and unmatched on guilds", () => {
    expect(suppressUsage({ ...counts, feature: "all", guilds: 4 })).toBeNull();
    expect(
      suppressUsage({ ...counts, feature: "unmatched", guilds: 4 }),
    ).toBeNull();
  });
});

describe("suppressRetention", () => {
  const counts = {
    cohortWeek: week,
    unit: "user" as const,
    feature: "social",
    weeksLater: 1,
    base: 20,
    retained: 8,
  };

  test("keeps large cells", () => {
    expect(suppressRetention(counts)).toEqual(counts);
  });

  test("keeps the row but hides small counts", () => {
    expect(suppressRetention({ ...counts, retained: 4 }).retained).toBeNull();
    expect(suppressRetention({ ...counts, base: 4, retained: 4 })).toEqual({
      ...counts,
      base: null,
      retained: null,
    });
  });
});

describe("isReportedRetention", () => {
  const counts = {
    cohortWeek: week,
    weeksLater: 1,
    base: 20,
    retained: 8,
  };

  test("reports a feature on its own unit and all on both", () => {
    expect(
      isReportedRetention({ ...counts, unit: "user", feature: "social" }),
    ).toBe(true);
    expect(
      isReportedRetention({ ...counts, unit: "guild", feature: "social" }),
    ).toBe(false);
    expect(
      isReportedRetention({ ...counts, unit: "guild", feature: "all" }),
    ).toBe(true);
  });
});
