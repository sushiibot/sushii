import { ALL_FEATURES } from "./ProductEvent";
import {
  type FeatureUnit,
  PRODUCT_FEATURES,
  unitsForFeature,
} from "./features";

export const RAW_RETENTION_DAYS = 89;
export const RETENTION_WEEKS_LATER = [1, 2, 4, 6] as const;
export const MAX_RETENTION_WEEKS = 6;
export const SMALL_GROUP_MIN = 5;
export const WATERMARK_LAG_ALERT_DAYS = 14;
export const OLDEST_ROW_ALERT_DAYS = 91;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * WEEK_MS);
}

/** Monday 00:00 UTC of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const midnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(midnight - daysSinceMonday * DAY_MS);
}

export function rawCutoff(now: Date): Date {
  return addDays(now, -RAW_RETENTION_DAYS);
}

/** The first week whose rows are all still stored; earlier cells stay unavailable. */
export function firstCompleteWeek(now: Date): Date {
  const cutoff = rawCutoff(now);
  const week = startOfWeek(cutoff);
  return week.getTime() === cutoff.getTime() ? week : addWeeks(week, 1);
}

export interface UsageCounts {
  week: Date;
  feature: string;
  guilds: number;
  actors: number;
  events: number;
}

export interface UsageCell {
  week: Date;
  feature: string;
  guilds: number | null;
  actors: number | null;
  events: number;
}

function primaryUnit(feature: string): FeatureUnit {
  if (feature === ALL_FEATURES) {
    return "guild";
  }
  return PRODUCT_FEATURES[feature]?.unit ?? "guild";
}

function keepIfLarge(count: number): number | null {
  return count < SMALL_GROUP_MIN ? null : count;
}

/** Tests a row on its feature's unit, so a mixed row can't vanish on the other count. */
export function suppressUsage(counts: UsageCounts): UsageCell | null {
  const unitCount =
    primaryUnit(counts.feature) === "user" ? counts.actors : counts.guilds;
  if (unitCount < SMALL_GROUP_MIN) {
    return null;
  }
  return {
    week: counts.week,
    feature: counts.feature,
    guilds: keepIfLarge(counts.guilds),
    actors: keepIfLarge(counts.actors),
    events: counts.events,
  };
}

export interface RetentionCounts {
  cohortWeek: Date;
  unit: FeatureUnit;
  feature: string;
  weeksLater: number;
  base: number;
  retained: number;
}

export interface RetentionCell {
  cohortWeek: Date;
  unit: FeatureUnit;
  feature: string;
  weeksLater: number;
  base: number | null;
  retained: number | null;
}

/** Keeps the row so a gap reads as "too small", not as missing. */
export function suppressRetention(counts: RetentionCounts): RetentionCell {
  const base = keepIfLarge(counts.base);
  return {
    cohortWeek: counts.cohortWeek,
    unit: counts.unit,
    feature: counts.feature,
    weeksLater: counts.weeksLater,
    base,
    retained: base === null ? null : keepIfLarge(counts.retained),
  };
}

export function isReportedRetention(counts: RetentionCounts): boolean {
  return unitsForFeature(counts.feature).includes(counts.unit);
}
