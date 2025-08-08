import { Result } from "ts-results";
import { CachedGuildEntity, NewCachedGuild } from "../entities";

export interface CachedGuildRepository {
  upsert(guildData: NewCachedGuild): Promise<Result<CachedGuildEntity, string>>;
}