import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import { cachedUsersInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type { CachedUserRepository, NewCachedUser } from "../domain";
import { CachedUserEntity } from "../domain";

export class DrizzleCachedUserRepository implements CachedUserRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async upsert(
    userData: NewCachedUser,
  ): Promise<Result<CachedUserEntity, string>> {
    try {
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

      return Ok(CachedUserEntity.fromData(result));
    } catch (error) {
      return Err(
        `Failed to upsert cached user: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async batchUpsert(
    usersData: NewCachedUser[],
  ): Promise<Result<CachedUserEntity[], string>> {
    if (usersData.length === 0) {
      return Ok([]);
    }

    try {
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

      return Ok(results.map((result) => CachedUserEntity.fromData(result)));
    } catch (error) {
      return Err(
        `Failed to batch upsert cached users: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
