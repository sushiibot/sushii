import { describe, expect, test } from "bun:test";

import {
  commandsIn,
  dailyTrend,
  featureAudiences,
  featureParts,
  featureSummaries,
  latestWeek,
  promptOutcomes,
  retentionCohorts,
  serverLevels,
  totals,
  updatePosts,
  usageOnDay,
  weeklyTrend,
} from "./metrics";
import type {
  DailyUsageRow,
  FeaturePartRow,
  RetentionRow,
  UsageRow,
} from "./types";

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

describe("commandsIn", () => {
  test("keeps one period, most used first", () => {
    const rows = [
      { period: "week", command: "rep", uses: 9, users: 5, servers: null },
      { period: "week", command: "rank", uses: 20, users: 8, servers: 5 },
      { period: "today", command: "rank", uses: 6, users: 5, servers: null },
    ] as const;

    expect(commandsIn(rows, "week").map((row) => row.command)).toEqual([
      "rank",
      "rep",
    ]);
  });
});

describe("serverLevels", () => {
  test("lists every level and tells zero from hidden", () => {
    const rows = [
      { period: "week", level: "1-9", servers: 12 },
      { period: "week", level: "10-99", servers: null },
    ] as const;

    expect(serverLevels(rows, "week")).toEqual([
      { level: "1-9", servers: 12 },
      { level: "10-99", servers: null },
      { level: "100+", servers: 0 },
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

describe("featureParts", () => {
  const part = (over: Partial<FeaturePartRow>): FeaturePartRow => ({
    period: "week",
    feature: "role-menu",
    part: "RoleMenuButtonHandler",
    kind: "button",
    audience: "member",
    events: 80,
    errors: 0,
    users: 40,
    servers: 10,
    ...over,
  });
  const feature = {
    feature: "role-menu",
    guilds: 12,
    actors: 45,
    events: 100,
    adoption: 0.24,
  };

  test("names parts, shares by active servers and folds the rest", () => {
    const rows = [
      part({
        part: "rolemenu create",
        kind: "command",
        audience: "staff",
        events: 15,
        users: 5,
        servers: null,
      }),
      part({}),
      part({ period: "today" }),
    ];

    expect(featureParts(rows, "week", feature, 50)).toEqual([
      {
        name: "Role Menu Button",
        detail: "Members · button",
        servers: 10,
        users: 40,
        events: 80,
        errors: 0,
        adoption: 0.2,
      },
      {
        name: "/rolemenu create",
        detail: "Staff · command",
        servers: null,
        users: 5,
        events: 15,
        errors: 0,
        adoption: null,
      },
      {
        name: "Other parts",
        detail: "",
        servers: null,
        users: null,
        events: 5,
        errors: 0,
        adoption: null,
      },
    ]);
  });

  test("a feature with no visible parts has nothing to open", () => {
    expect(featureParts([], "week", feature, 50)).toEqual([]);
  });
});

describe("featureAudiences", () => {
  test("lists members first, in the chosen period", () => {
    const row = { feature: "role-menu", users: 5, servers: 5 };
    expect(
      featureAudiences(
        [
          { ...row, period: "week", audience: "staff", events: 3 },
          { ...row, period: "week", audience: "member", events: 520 },
          { ...row, period: "today", audience: "member", events: 9 },
        ],
        "week",
        "role-menu",
      ),
    ).toEqual([
      { label: "Members", events: 520 },
      { label: "Staff", events: 3 },
    ]);
  });
});

describe("promptOutcomes", () => {
  test("segments add up to everyone shown", () => {
    const [outcome] = promptOutcomes([
      {
        prompt: "follow_updates",
        outcome: "no_response",
        people: 15,
        shown: 30,
      },
      { prompt: "follow_updates", outcome: "completed", people: 11, shown: 30 },
      {
        prompt: "follow_updates",
        outcome: "dismissed",
        people: null,
        shown: 30,
      },
    ]);

    expect(outcome.segments.map((s) => [s.label, s.people])).toEqual([
      ["Turned on notifications", 11],
      ["No response", 15],
      ["Each under 5", 4],
    ]);
    expect(outcome.segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(
      1,
    );
  });
});
