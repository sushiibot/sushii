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

export interface RetentionRow {
  cohort_week: string;
  unit: "user" | "guild";
  feature: string;
  weeks_later: number;
  base: number | null;
  retained: number | null;
}

export interface PromptFunnelRow {
  week: string;
  prompt: string;
  step: string;
  action: string;
  actors: number;
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
