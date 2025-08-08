import type { CatchableType } from "../constants";

export interface FishyResult {
  caughtAmount: number;
  caughtType: CatchableType;
  oldAmount: string;
  newAmount: string;
}

export interface RepResult {
  oldAmount: string;
  newAmount: string;
}