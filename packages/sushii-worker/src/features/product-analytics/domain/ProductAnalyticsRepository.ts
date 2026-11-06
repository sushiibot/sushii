import type { ProductEventRow } from "./ProductEvent";
import type {
  RetentionCell,
  RetentionCounts,
  UsageCell,
  UsageCounts,
} from "./rollup";

export interface ProductAnalyticsRepository {
  insert(event: ProductEventRow): Promise<void>;
  /** Runs `work` while holding the rollup lock, so two slots can't run it at once. */
  withRollupLock(
    work: (tx: ProductRollupTransaction) => Promise<void>,
  ): Promise<void>;
  deleteOlderThan(cutoff: Date): Promise<number>;
  oldestEventAt(): Promise<Date | null>;
  deleteUserData(userId: string, actor: Buffer): Promise<UserDataDeletion>;
}

export interface ProductRollupTransaction {
  getWatermark(): Promise<Date | null>;
  setWatermark(week: Date): Promise<void>;
  oldestEventAt(): Promise<Date | null>;
  usageCounts(from: Date, to: Date): Promise<UsageCounts[]>;
  retentionCounts(from: Date, to: Date): Promise<RetentionCounts[]>;
  upsertUsage(cells: UsageCell[]): Promise<void>;
  upsertRetention(cells: RetentionCell[]): Promise<void>;
}

export interface UserDataDeletion {
  usageRecords: number;
  feedback: number;
  promptStates: number;
}
