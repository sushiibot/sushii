import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { cachedUsersInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type { CachedUserRepository, NewCachedUser } from "../domain";
import { CachedUserEntity } from "../domain";

export class DrizzleCachedUserRepository implements CachedUserRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async upsert(userData: NewCachedUser): Promise<CachedUserEntity> {
    const [result] = await this.db
      .insert(cachedUsersInAppPublic)
      .values(userData)
      .onConflictDoUpdate({
        target: cachedUsersInAppPublic.id,
        set: {
          name: userData.name,
          discriminator: userData.discriminator,
          avatarUrl: userData.avatarUrl,
          lastChecked: userData.lastChecked,
        },
      })
      .returning();

    return CachedUserEntity.fromData(result);
  }

  async batchUpsert(usersData: NewCachedUser[]): Promise<CachedUserEntity[]> {
    if (usersData.length === 0) {
      return [];
    }

    const results = await this.db
      .insert(cachedUsersInAppPublic)
      .values(usersData)
      .onConflictDoUpdate({
        target: cachedUsersInAppPublic.id,
        set: {
          name: sql`excluded.name`,
          discriminator: sql`excluded.discriminator`,
          avatarUrl: sql`excluded.avatar_url`,
          lastChecked: sql`excluded.last_checked`,
        },
      })
      .returning();

    return results.map((result) => CachedUserEntity.fromData(result));
  }
}
