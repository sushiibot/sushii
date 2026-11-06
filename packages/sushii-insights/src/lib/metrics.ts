import type { RetentionRow, UpdateReachRow, UsageRow } from "./types";

export const ALL_FEATURES = "all";
export const RETENTION_WEEKS = [1, 2, 4, 6] as const;

export const day = (value: string): string => value.slice(0, 10);

export interface Point {
  label: string;
  value: number;
}

export function weeklyTrend(
  usage: readonly UsageRow[],
  measure: "guilds" | "actors",
): Point[] {
  return usage
    .filter((row) => row.feature === ALL_FEATURES && row[measure] !== null)
    .map((row) => ({ label: day(row.week), value: row[measure] as number }))
    .sort((a, b) => a.label.localeCompare(b.label));
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
  const total = rows.find((row) => row.feature === ALL_FEATURES)?.guilds ?? null;

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
