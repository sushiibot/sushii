import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import { cachedGuildsInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type { CachedGuildRepository, NewCachedGuild } from "../domain";
import { CachedGuildEntity } from "../domain";

export class DrizzleCachedGuildRepository implements CachedGuildRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async upsert(
    guildData: NewCachedGuild,
  ): Promise<Result<CachedGuildEntity, string>> {
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
            memberCount: guildData.memberCount,
            updatedAt: guildData.updatedAt,
          },
        })
        .returning();

      return Ok(CachedGuildEntity.fromData(result));
    } catch (error) {
      return Err(
        `Failed to upsert cached guild: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async incrementMemberCount(guildId: bigint): Promise<Result<void, string>> {
    try {
      const [result] = await this.db
        .update(cachedGuildsInAppPublic)
        .set({
          memberCount: sql`COALESCE(${cachedGuildsInAppPublic.memberCount}, 0) + 1`,
          updatedAt: new Date().toISOString(),
        })
        .where(sql`${cachedGuildsInAppPublic.id} = ${guildId}`)
        .returning({ id: cachedGuildsInAppPublic.id });

      if (!result) {
        return Err(`Guild ${guildId} not found in cache`);
      }

      return Ok.EMPTY;
    } catch (error) {
      return Err(
        `Failed to increment member count: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async decrementMemberCount(guildId: bigint): Promise<Result<void, string>> {
    try {
      const [result] = await this.db
        .update(cachedGuildsInAppPublic)
        .set({
          memberCount: sql`GREATEST(COALESCE(${cachedGuildsInAppPublic.memberCount}, 1) - 1, 0)`,
          updatedAt: new Date().toISOString(),
        })
        .where(sql`${cachedGuildsInAppPublic.id} = ${guildId}`)
        .returning({ id: cachedGuildsInAppPublic.id });

      if (!result) {
        return Err(`Guild ${guildId} not found in cache`);
      }

      return Ok.EMPTY;
    } catch (error) {
      return Err(
        `Failed to decrement member count: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
