import { describe, expect, test } from "bun:test";

import {
  dailyTrend,
  featureSummaries,
  latestWeek,
  retentionCohorts,
  totals,
  updatePosts,
  usageOnDay,
  weeklyTrend,
} from "./metrics";
import type { DailyUsageRow, RetentionRow, UsageRow } from "./types";

const usage: UsageRow[] = [
  { week: "2026-10-26", feature: "all", guilds: 40, actors: 90, events: 500 },
  { week: "2026-11-02", feature: "all", guilds: 50, actors: 100, events: 600 },
  {
    week: "2026-11-02",
    feature: "social",
    guilds: 10,
    actors: 60,
    events: 300,
  },
  { week: "2026-11-02", feature: "tags", guilds: 25, actors: null, events: 90 },
];

const currentWeek: UsageRow[] = [
  { week: "2026-11-09", feature: "all", guilds: 12, actors: null, events: 70 },
];

const daily: DailyUsageRow[] = [
  { day: "2026-11-10", feature: "all", guilds: 8, actors: null, events: 40 },
  { day: "2026-11-09", feature: "all", guilds: 6, actors: 9, events: 30 },
  { day: "2026-11-10", feature: "social", guilds: 5, actors: 5, events: 12 },
];

describe("weeklyTrend", () => {
  test("uses the all row, oldest first, and marks the open week", () => {
    expect(weeklyTrend(usage, currentWeek, "guilds")).toEqual([
      { label: "2026-10-26", value: 40 },
      { label: "2026-11-02", value: 50 },
      { label: "2026-11-09 (so far)", value: 12 },
    ]);
  });

  test("skips an open week whose count is hidden", () => {
    expect(weeklyTrend([], currentWeek, "actors")).toEqual([]);
  });
});

describe("dailyTrend", () => {
  test("uses the all row, oldest first, and skips hidden counts", () => {
    expect(dailyTrend(daily, "events")).toEqual([
      { label: "2026-11-09", value: 30 },
      { label: "2026-11-10", value: 40 },
    ]);
    expect(dailyTrend(daily, "actors")).toEqual([
      { label: "2026-11-09", value: 9 },
    ]);
  });
});

describe("usageOnDay", () => {
  test("feeds one day into totals and the feature table", () => {
    const today = usageOnDay(daily, "2026-11-10");

    expect(totals(today)?.events).toBe(40);
    expect(featureSummaries(today)).toEqual([
      {
        feature: "social",
        guilds: 5,
        actors: 5,
        events: 12,
        adoption: 5 / 8,
      },
    ]);
  });
});

describe("featureSummaries", () => {
  test("covers the latest week, busiest first, with adoption", () => {
    expect(latestWeek(usage)).toBe("2026-11-02");
    const summaries = featureSummaries(usage);
    expect(summaries.map((s) => s.feature)).toEqual(["social", "tags"]);
    expect(summaries[1].adoption).toBe(0.5);
  });

  test("has no adoption when the guild count is hidden", () => {
    const hidden = usage.map((row) =>
      row.feature === "tags" ? { ...row, guilds: null } : row,
    );
    expect(featureSummaries(hidden)[1].adoption).toBeNull();
  });
});

describe("retentionCohorts", () => {
  const rows: RetentionRow[] = [
    {
      cohort_week: "2026-10-05",
      unit: "user",
      feature: "social",
      weeks_later: 1,
      base: 20,
      retained: 10,
    },
    {
      cohort_week: "2026-10-05",
      unit: "user",
      feature: "social",
      weeks_later: 2,
      base: 20,
      retained: null,
    },
    {
      cohort_week: "2026-10-05",
      unit: "guild",
      feature: "social",
      weeks_later: 1,
      base: 9,
      retained: 9,
    },
  ];

  test("turns counts into rates for one unit and feature", () => {
    expect(retentionCohorts(rows, "user", "social")).toEqual([
      { cohortWeek: "2026-10-05", base: 20, rates: { 1: 0.5, 2: null } },
    ]);
  });
});

describe("updatePosts", () => {
  test("adds up sent and everything else per post", () => {
    expect(
      updatePosts([
        { post_id: "1", posted_on: "2026-11-01", status: "sent", guilds: 30 },
        { post_id: "1", posted_on: "2026-11-01", status: "failed", guilds: 2 },
        { post_id: "1", posted_on: "2026-11-01", status: "skipped", guilds: 3 },
      ]),
    ).toEqual([{ postId: "1", postedOn: "2026-11-01", sent: 30, other: 5 }]);
  });
});
