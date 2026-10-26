import type { FeatureFlag, FeatureFlagEntry } from "./FeatureFlag";

export interface FeatureFlagRepository {
  /** Called on every message: served from an in-memory snapshot refreshed at most every 60s. */
  isEnabled(guildId: string, flag: FeatureFlag): Promise<boolean>;
  listGuilds(flag: FeatureFlag): Promise<FeatureFlagEntry[]>;
  /** Idempotent; refreshes the local snapshot. */
  enable(guildId: string, flag: FeatureFlag, enabledBy: string): Promise<void>;
  /** Returns false when the flag wasn't on. */
  disable(guildId: string, flag: FeatureFlag): Promise<boolean>;
}
