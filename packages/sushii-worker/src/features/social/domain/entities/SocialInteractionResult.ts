import type { CatchableType } from "../constants";
import type { StreakUpdate } from "./Streak";

export interface FishyResult {
  // Amount before the streak multiplier
  baseAmount: number;
  caughtAmount: number;
  caughtType: CatchableType;
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
