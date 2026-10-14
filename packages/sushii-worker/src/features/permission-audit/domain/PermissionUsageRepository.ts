import type { PermissionUsage } from "./PermissionUsage";

export interface PermissionUsageRepository {
  record(usages: readonly PermissionUsage[]): Promise<void>;
  /** No-op if the guild already has a tracking start; the first one wins. */
  ensureTrackingStarted(guildId: string, startedAt: Date): Promise<void>;
  deleteLastUsedBefore(cutoff: Date): Promise<number>;
  deleteGuild(guildId: string): Promise<void>;
}
