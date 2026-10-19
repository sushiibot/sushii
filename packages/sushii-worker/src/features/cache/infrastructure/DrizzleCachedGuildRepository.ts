import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { cachedGuildsInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type { CachedGuildRepository, NewCachedGuild } from "../domain";
import { CachedGuildEntity } from "../domain";

export class DrizzleCachedGuildRepository implements CachedGuildRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async upsert(guildData: NewCachedGuild): Promise<CachedGuildEntity> {
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

    return CachedGuildEntity.fromData(result);
  }

  async incrementMemberCount(guildId: bigint): Promise<boolean> {
    const [result] = await this.db
      .update(cachedGuildsInAppPublic)
      .set({
        memberCount: sql`COALESCE(${cachedGuildsInAppPublic.memberCount}, 0) + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(sql`${cachedGuildsInAppPublic.id} = ${guildId}`)
      .returning({ id: cachedGuildsInAppPublic.id });

    return result !== undefined;
  }

  async decrementMemberCount(guildId: bigint): Promise<boolean> {
    const [result] = await this.db
      .update(cachedGuildsInAppPublic)
      .set({
        memberCount: sql`GREATEST(COALESCE(${cachedGuildsInAppPublic.memberCount}, 1) - 1, 0)`,
        updatedAt: new Date().toISOString(),
      })
      .where(sql`${cachedGuildsInAppPublic.id} = ${guildId}`)
      .returning({ id: cachedGuildsInAppPublic.id });

    return result !== undefined;
  }
}
