import { Result, Ok, Err } from "ts-results";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { cachedGuildsInAppPublic } from "@/infrastructure/database/schema";
import * as schema from "@/infrastructure/database/schema";
import { CachedGuildRepository, CachedGuildEntity, NewCachedGuild } from "../domain";

export class DrizzleCachedGuildRepository implements CachedGuildRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async upsert(guildData: NewCachedGuild): Promise<Result<CachedGuildEntity, string>> {
    try {
      const [result] = await this.db
        .insert(cachedGuildsInAppPublic)
        .values(guildData)
        .onConflictDoUpdate({
          target: cachedGuildsInAppPublic.id,
          set: {
            name: guildData.name,
            icon: guildData.icon,
            banner: guildData.banner,
            splash: guildData.splash,
            features: guildData.features,
            updatedAt: guildData.updatedAt,
          },
        })
        .returning();

      return Ok(CachedGuildEntity.fromData(result));
    } catch (error) {
      return Err(`Failed to upsert cached guild: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}