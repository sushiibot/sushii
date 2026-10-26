import type { FishingCondition } from "../collection/Catalog";

export interface ActiveDaysSummary {
  activeDays: number;
  multiplier: number;
}

export interface FishyResult {
  collectibleId: string;
  condition: FishingCondition;
  catchCount: number;
  firstDiscovery: boolean;
  // Amount before the active days multiplier
  baseAmount: number;
  caughtAmount: number;
  oldAmount: string;
  newAmount: string;
  activity: ActiveDaysSummary;
}

export interface RepResult {
  amount: number;
  // Whether the active days multiplier rolled a bonus rep
  isBonus: boolean;
  oldAmount: string;
  newAmount: string;
  activity: ActiveDaysSummary;
}
