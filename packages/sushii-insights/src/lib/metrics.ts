import type {
  ActivityPeriod,
  CommandUsageRow,
  DailyUsageRow,
  FeatureAudienceRow,
  FeaturePartRow,
  FeaturePeriod,
  PromptOutcomeRow,
  RetentionRow,
  ServerActivityRow,
  UpdateReachRow,
  UsageRow,
} from "./types";

export const ALL_FEATURES = "all";
export const RETENTION_WEEKS = [1, 2, 4, 6] as const;

export const day = (value: string): string => value.slice(0, 10);

export interface Point {
  label: string;
  value: number;
}

export type Measure = "guilds" | "actors" | "events";

export function weeklyTrend(
  usage: readonly UsageRow[],
  currentWeek: readonly UsageRow[],
  measure: Measure,
): Point[] {
  const toPoints = (rows: readonly UsageRow[], suffix: string) =>
    rows
      .filter((row) => row.feature === ALL_FEATURES && row[measure] !== null)
      .map((row) => ({
        label: `${day(row.week)}${suffix}`,
        value: row[measure] as number,
      }));

  return [...toPoints(usage, ""), ...toPoints(currentWeek, " (so far)")].sort(
    (a, b) => a.label.localeCompare(b.label),
  );
}

export function dailyTrend(
  daily: readonly DailyUsageRow[],
  measure: Measure,
): Point[] {
  return daily
    .filter((row) => row.feature === ALL_FEATURES && row[measure] !== null)
    .map((row) => ({ label: day(row.day), value: row[measure] as number }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Daily rows for one day, shaped like a week so the feature table can use them. */
export function usageOnDay(
  daily: readonly DailyUsageRow[],
  date: string,
): UsageRow[] {
  return daily
    .filter((row) => day(row.day) === date)
    .map(({ day: week, ...row }) => ({ ...row, week }));
}

export function totals(rows: readonly UsageRow[]): UsageRow | null {
  return rows.find((row) => row.feature === ALL_FEATURES) ?? null;
}

export interface FeatureSummary {
  feature: string;
  guilds: number | null;
  actors: number | null;
  events: number;
  /** Share of all active servers that week, 0 to 1. */
  adoption: number | null;
}

export function latestWeek(usage: readonly UsageRow[]): string | null {
  const weeks = usage.map((row) => day(row.week)).sort();
  return weeks.at(-1) ?? null;
}

export function featureSummaries(usage: readonly UsageRow[]): FeatureSummary[] {
  const week = latestWeek(usage);
  const rows = usage.filter((row) => day(row.week) === week);
  const total =
    rows.find((row) => row.feature === ALL_FEATURES)?.guilds ?? null;

  return rows
    .filter((row) => row.feature !== ALL_FEATURES)
    .map((row) => ({
      feature: row.feature,
      guilds: row.guilds,
      actors: row.actors,
      events: row.events,
      adoption:
        row.guilds !== null && total ? Math.min(row.guilds / total, 1) : null,
    }))
    .sort((a, b) => b.events - a.events);
}

const AUDIENCE_LABELS: Record<string, string> = {
  member: "Members",
  staff: "Staff",
  bot: "Bot",
  unknown: "Not classified",
};
const AUDIENCE_ORDER = ["member", "staff", "bot", "unknown"];

export const audienceLabel = (audience: string): string =>
  AUDIENCE_LABELS[audience] ?? audience;

export interface FeatureAudience {
  label: string;
  events: number;
}

export function featureAudiences(
  rows: readonly FeatureAudienceRow[],
  period: FeaturePeriod,
  feature: string,
): FeatureAudience[] {
  return rows
    .filter((row) => row.period === period && row.feature === feature)
    .sort(
      (a, b) =>
        AUDIENCE_ORDER.indexOf(a.audience) - AUDIENCE_ORDER.indexOf(b.audience),
    )
    .map((row) => ({ label: audienceLabel(row.audience), events: row.events }));
}

function partName(row: FeaturePartRow): string {
  if (row.kind === "command") {
    return `/${row.part}`;
  }
  const words = row.part
    .replace(/(Handler|Command)$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface FeaturePart {
  name: string;
  /** Empty for the row that folds in parts under 5 users. */
  detail: string;
  servers: number | null;
  users: number | null;
  events: number;
  errors: number;
  adoption: number | null;
}

export function featureParts(
  rows: readonly FeaturePartRow[],
  period: FeaturePeriod,
  feature: FeatureSummary,
  activeServers: number | null,
): FeaturePart[] {
  const parts = rows
    .filter((row) => row.period === period && row.feature === feature.feature)
    .sort((a, b) => b.events - a.events)
    .map((row) => ({
      name: partName(row),
      detail: `${audienceLabel(row.audience)} · ${row.kind}`,
      servers: row.servers,
      users: row.users,
      events: row.events,
      errors: row.errors,
      adoption:
        row.servers !== null && activeServers
          ? Math.min(row.servers / activeServers, 1)
          : null,
    }));

  const shown = parts.reduce((sum, part) => sum + part.events, 0);
  if (parts.length === 0 || shown >= feature.events) {
    return parts;
  }
  return [
    ...parts,
    {
      name: "Other parts",
      detail: "",
      servers: null,
      users: null,
      events: feature.events - shown,
      errors: 0,
      adoption: null,
    },
  ];
}

const PROMPT_GOALS: Record<string, string> = {
  follow_updates: "Turned on notifications",
  proof_intro: "Added proof within 7 days",
};

const OUTCOMES = [
  { id: "completed", label: "Did what it asked" },
  { id: "started", label: "Started, didn't finish" },
  { id: "snoozed", label: "Snoozed" },
  { id: "dismissed", label: "Dismissed" },
  { id: "no_response", label: "No response" },
];

export interface PromptSegment {
  id: string;
  label: string;
  people: number;
  share: number;
}

export interface PromptOutcome {
  prompt: string;
  shown: number;
  segments: PromptSegment[];
}

export function promptOutcomes(
  rows: readonly PromptOutcomeRow[],
): PromptOutcome[] {
  const prompts = [...new Set(rows.map((row) => row.prompt))].sort();

  return prompts
    .map((prompt) => {
      const own = rows.filter((row) => row.prompt === prompt);
      const shown = own[0].shown;
      const segment = (id: string, label: string, people: number) => ({
        id,
        label,
        people,
        share: people / shown,
      });

      const segments = OUTCOMES.flatMap(({ id, label }) => {
        const people = own.find((row) => row.outcome === id)?.people;
        if (!people) {
          return [];
        }
        const goal = id === "completed" ? PROMPT_GOALS[prompt] : undefined;
        return [segment(id, goal ?? label, people)];
      });

      const counted = segments.reduce((sum, s) => sum + s.people, 0);
      return {
        prompt,
        shown,
        segments:
          counted < shown
            ? [...segments, segment("hidden", "Each under 5", shown - counted)]
            : segments,
      };
    })
    .sort((a, b) => b.shown - a.shown);
}

export const SERVER_LEVELS = ["1-9", "10-99", "100+"] as const;

export function commandsIn(
  rows: readonly CommandUsageRow[],
  period: ActivityPeriod,
): CommandUsageRow[] {
  return rows
    .filter((row) => row.period === period)
    .sort((a, b) => b.uses - a.uses);
}

export interface ServerLevel {
  level: string;
  /** Null means under 5 servers; a level nobody reached is 0. */
  servers: number | null;
}

export function serverLevels(
  rows: readonly ServerActivityRow[],
  period: ActivityPeriod,
): ServerLevel[] {
  return SERVER_LEVELS.map((level) => {
    const row = rows.find((r) => r.period === period && r.level === level);
    return { level, servers: row ? row.servers : 0 };
  });
}

export interface RetentionCohort {
  cohortWeek: string;
  base: number | null;
  /** Null means too small to show or not known yet. */
  rates: Record<number, number | null>;
}

export function retentionCohorts(
  rows: readonly RetentionRow[],
  unit: RetentionRow["unit"],
  feature: string,
): RetentionCohort[] {
  const cohorts = new Map<string, RetentionCohort>();

  for (const row of rows) {
    if (row.unit !== unit || row.feature !== feature) {
      continue;
    }
    const cohortWeek = day(row.cohort_week);
    const cohort = cohorts.get(cohortWeek) ?? {
      cohortWeek,
      base: row.base,
      rates: {},
    };
    cohort.rates[row.weeks_later] =
      row.base && row.retained !== null ? row.retained / row.base : null;
    cohorts.set(cohortWeek, cohort);
  }

  return [...cohorts.values()].sort((a, b) =>
    b.cohortWeek.localeCompare(a.cohortWeek),
  );
}

export function retentionFeatures(rows: readonly RetentionRow[]): string[] {
  return [...new Set(rows.map((row) => row.feature))].sort();
}

export interface UpdatePost {
  postId: string;
  postedOn: string;
  sent: number;
  other: number;
}

export function updatePosts(rows: readonly UpdateReachRow[]): UpdatePost[] {
  const posts = new Map<string, UpdatePost>();

  for (const row of rows) {
    const post = posts.get(row.post_id) ?? {
      postId: row.post_id,
      postedOn: day(row.posted_on),
      sent: 0,
      other: 0,
    };
    if (row.status === "sent") {
      post.sent += row.guilds;
    } else {
      post.other += row.guilds;
    }
    posts.set(row.post_id, post);
  }

  return [...posts.values()].sort((a, b) =>
    b.postedOn.localeCompare(a.postedOn),
  );
}
