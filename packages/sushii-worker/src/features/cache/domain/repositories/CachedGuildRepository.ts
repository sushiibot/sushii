import type { Result } from "ts-results";

import type { CachedGuildEntity, NewCachedGuild } from "../entities";

export interface CachedGuildRepository {
  upsert(guildData: NewCachedGuild): Promise<Result<CachedGuildEntity, string>>;
  incrementMemberCount(guildId: bigint): Promise<Result<void, string>>;
  decrementMemberCount(guildId: bigint): Promise<Result<void, string>>;
}
