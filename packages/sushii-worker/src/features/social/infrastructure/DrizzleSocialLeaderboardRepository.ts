import { and, count, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import {
  userLevelsInAppPublic,
  usersInAppPublic,
} from "@/infrastructure/database/schema";

import { SocialLeaderboardEntry } from "../domain/entities/SocialLeaderboardEntry";
import type { SocialLeaderboardRepository } from "../domain/repositories/SocialLeaderboardRepository";

export class DrizzleSocialLeaderboardRepository
  implements SocialLeaderboardRepository
{
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async getRepLeaderboardPage(
    guildId: string,
    pageIndex: number,
    pageSize: number,
  ): Promise<SocialLeaderboardEntry[]> {
    try {
      const result = await this.db
        .select({
          userId: usersInAppPublic.id,
          rep: usersInAppPublic.rep,
        })
        .from(usersInAppPublic)
        .innerJoin(
          userLevelsInAppPublic,
          eq(usersInAppPublic.id, userLevelsInAppPublic.userId),
        )
        .where(
          and(
            eq(userLevelsInAppPublic.guildId, BigInt(guildId)),
            sql`${usersInAppPublic.rep} > 0`,
          ),
        )
        .orderBy(desc(usersInAppPublic.rep), desc(usersInAppPublic.id))
        .limit(pageSize)
        .offset(pageIndex * pageSize);

      return result.map((row, index) =>
        SocialLeaderboardEntry.create(
          String(row.userId),
          pageIndex * pageSize + index + 1,
          row.rep,
        ),
      );
    } catch (error) {
      throw new Error(
        `Failed to get rep leaderboard page for guildId ${guildId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getFishyLeaderboardPage(
    guildId: string,
    pageIndex: number,
    pageSize: number,
  ): Promise<SocialLeaderboardEntry[]> {
    try {
      const result = await this.db
        .select({
          userId: usersInAppPublic.id,
          fishies: usersInAppPublic.fishies,
        })
        .from(usersInAppPublic)
        .innerJoin(
          userLevelsInAppPublic,
          eq(usersInAppPublic.id, userLevelsInAppPublic.userId),
        )
        .where(
          and(
            eq(userLevelsInAppPublic.guildId, BigInt(guildId)),
            sql`${usersInAppPublic.fishies} > 0`,
          ),
        )
        .orderBy(desc(usersInAppPublic.fishies), desc(usersInAppPublic.id))
        .limit(pageSize)
        .offset(pageIndex * pageSize);

      return result.map((row, index) =>
        SocialLeaderboardEntry.create(
          String(row.userId),
          pageIndex * pageSize + index + 1,
          row.fishies,
        ),
      );
    } catch (error) {
      throw new Error(
        `Failed to get fishy leaderboard page for guildId ${guildId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getUserRepRank(
    guildId: string,
    userId: string,
  ): Promise<number | null> {
    try {
      // First check if user has any rep
      const userRepResult = await this.db
        .select({ rep: usersInAppPublic.rep })
        .from(usersInAppPublic)
        .where(eq(usersInAppPublic.id, BigInt(userId)))
        .limit(1);

      if (!userRepResult[0] || userRepResult[0].rep <= 0) {
        return null;
      }

      const userRep = userRepResult[0].rep;

      // Count users with higher rep in the guild (including ties with higher user ID)
      const rankResult = await this.db
        .select({ count: count() })
        .from(usersInAppPublic)
        .innerJoin(
          userLevelsInAppPublic,
          eq(usersInAppPublic.id, userLevelsInAppPublic.userId),
        )
        .where(
          and(
            eq(userLevelsInAppPublic.guildId, BigInt(guildId)),
            sql`(${usersInAppPublic.rep} > ${userRep} OR (${usersInAppPublic.rep} = ${userRep} AND ${usersInAppPublic.id} > ${BigInt(userId)}))`,
          ),
        );

      return (rankResult[0]?.count ?? 0) + 1;
    } catch (error) {
      throw new Error(
        `Failed to get user rep rank for userId ${userId}, guildId ${guildId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getUserFishyRank(
    guildId: string,
    userId: string,
  ): Promise<number | null> {
    try {
      // First check if user has any fishies
      const userFishyResult = await this.db
        .select({ fishies: usersInAppPublic.fishies })
        .from(usersInAppPublic)
        .where(eq(usersInAppPublic.id, BigInt(userId)))
        .limit(1);

      if (!userFishyResult[0] || userFishyResult[0].fishies <= 0) {
        return null;
      }

      const userFishies = userFishyResult[0].fishies;

      // Count users with higher fishies in the guild (including ties with higher user ID)
      const rankResult = await this.db
        .select({ count: count() })
        .from(usersInAppPublic)
        .innerJoin(
          userLevelsInAppPublic,
          eq(usersInAppPublic.id, userLevelsInAppPublic.userId),
        )
        .where(
          and(
            eq(userLevelsInAppPublic.guildId, BigInt(guildId)),
            sql`(${usersInAppPublic.fishies} > ${userFishies} OR (${usersInAppPublic.fishies} = ${userFishies} AND ${usersInAppPublic.id} > ${BigInt(userId)}))`,
          ),
        );

      return (rankResult[0]?.count ?? 0) + 1;
    } catch (error) {
      throw new Error(
        `Failed to get user fishy rank for userId ${userId}, guildId ${guildId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getRepLeaderboardCount(guildId: string): Promise<number> {
    try {
      const result = await this.db
        .select({ count: count() })
        .from(usersInAppPublic)
        .innerJoin(
          userLevelsInAppPublic,
          eq(usersInAppPublic.id, userLevelsInAppPublic.userId),
        )
        .where(
          and(
            eq(userLevelsInAppPublic.guildId, BigInt(guildId)),
            sql`${usersInAppPublic.rep} > 0`,
          ),
        );

      return result[0]?.count ?? 0;
    } catch (error) {
      throw new Error(
        `Failed to get rep leaderboard count for guildId ${guildId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getFishyLeaderboardCount(guildId: string): Promise<number> {
    try {
      const result = await this.db
        .select({ count: count() })
        .from(usersInAppPublic)
        .innerJoin(
          userLevelsInAppPublic,
          eq(usersInAppPublic.id, userLevelsInAppPublic.userId),
        )
        .where(
          and(
            eq(userLevelsInAppPublic.guildId, BigInt(guildId)),
            sql`${usersInAppPublic.fishies} > 0`,
          ),
        );

      return result[0]?.count ?? 0;
    } catch (error) {
      throw new Error(
        `Failed to get fishy leaderboard count for guildId ${guildId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
