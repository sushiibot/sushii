export interface UsageRow {
  week: string;
  feature: string;
  guilds: number | null;
  actors: number | null;
  events: number;
}

export interface DailyUsageRow {
  day: string;
  feature: string;
  guilds: number | null;
  actors: number | null;
  events: number;
}

export type ActivityPeriod = "today" | "week" | "30d";

export interface CommandUsageRow {
  period: ActivityPeriod;
  command: string;
  uses: number;
  users: number;
  servers: number | null;
}

export interface ServerActivityRow {
  period: ActivityPeriod;
  level: string;
  servers: number | null;
}

export interface RetentionRow {
  cohort_week: string;
  unit: "user" | "guild";
  feature: string;
  weeks_later: number;
  base: number | null;
  retained: number | null;
}

export type FeaturePeriod = "today" | "week" | "closed";

export interface FeaturePartRow {
  period: FeaturePeriod;
  feature: string;
  part: string;
  kind: string;
  audience: string;
  events: number;
  errors: number;
  users: number | null;
  servers: number | null;
}

export interface FeatureAudienceRow {
  period: FeaturePeriod;
  feature: string;
  audience: string;
  events: number;
  users: number | null;
  servers: number | null;
}

export interface PromptOutcomeRow {
  prompt: string;
  outcome: string;
  /** Null means under 5 people. */
  people: number | null;
  shown: number;
}

export interface UpdateReachRow {
  post_id: string;
  posted_on: string;
  status: string;
  guilds: number;
}

export interface ProofRow {
  week: string;
  source: string;
  guilds: number;
  proofs: number;
  median_minutes_to_proof: number | null;
}
