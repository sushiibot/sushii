import type { FishingCondition } from "../collection/Catalog";
import type { StreakUpdate } from "./Streak";

export interface FishyResult {
  collectibleId: string;
  condition: FishingCondition;
  catchCount: number;
  firstDiscovery: boolean;
  // Amount before the streak multiplier
  baseAmount: number;
  caughtAmount: number;
  oldAmount: string;
  newAmount: string;
  streak: StreakUpdate;
}

export interface RepResult {
  amount: number;
  // Whether the streak multiplier rolled a bonus rep
  isStreakBonus: boolean;
  oldAmount: string;
  newAmount: string;
  streak: StreakUpdate;
}
