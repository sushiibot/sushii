import type { Result } from "ts-results";
import type { CachedGuildEntity, NewCachedGuild } from "../entities";

export interface CachedGuildRepository {
  upsert(guildData: NewCachedGuild): Promise<Result<CachedGuildEntity, string>>;
}