import type { CachedGuildEntity, NewCachedGuild } from "../entities";

export interface CachedGuildRepository {
  upsert(guildData: NewCachedGuild): Promise<CachedGuildEntity>;

  /**
   * Increments the cached member count.
   * Returns false if the guild is not in the cache.
   */
  incrementMemberCount(guildId: bigint): Promise<boolean>;

  /**
   * Decrements the cached member count (floored at 0).
   * Returns false if the guild is not in the cache.
   */
  decrementMemberCount(guildId: bigint): Promise<boolean>;
}
