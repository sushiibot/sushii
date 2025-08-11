import { and, count, desc, eq, sql, sum } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { userLevelsInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import { GlobalUserLevel } from "../domain/entities/GlobalUserLevel";
import { LeaderboardEntry } from "../domain/entities/LeaderboardEntry";
import { UserLevel } from "../domain/entities/UserLevel";
import { UserRank } from "../domain/entities/UserRank";
import type { UserLevelRepository as IUserLevelRepository } from "../domain/repositories/UserLevelRepository";
import { TimeFrame } from "../domain/value-objects/TimeFrame";

export type DrizzleDB = NodePgDatabase<typeof schema>;

interface UserRankData {
  rank: number | null;
  total_count: number;
}

export class UserLevelRepository implements IUserLevelRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async getUserGuildLevel(guildId: string, userId: string): Promise<UserLevel> {
    const result = await this.findByUserAndGuild(userId, guildId);
    return result || UserLevel.create(userId, guildId);
  }

  async findByUserAndGuild(
    userId: string,
    guildId: string,
  ): Promise<UserLevel | null> {
    try {
      const result = await this.db
        .select()
        .from(userLevelsInAppPublic)
        .where(
          and(
            eq(userLevelsInAppPublic.userId, BigInt(userId)),
            eq(userLevelsInAppPublic.guildId, BigInt(guildId)),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const record = result[0];
      return new UserLevel(
        userId,
        guildId,
        Number(record.msgAllTime),
        Number(record.msgMonth),
        Number(record.msgWeek),
        Number(record.msgDay),
        new Date(record.lastMsg),
      );
    } catch (error) {
      throw new Error(
        `Failed to find user level for userId ${userId}, guildId ${guildId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async save(userLevel: UserLevel): Promise<void> {
    await this.db
      .update(userLevelsInAppPublic)
      .set({
        msgAllTime: BigInt(userLevel.getAllTimeXp()),
        msgMonth: BigInt(userLevel.getMonthXp()),
        msgWeek: BigInt(userLevel.getWeekXp()),
        msgDay: BigInt(userLevel.getDayXp()),
        lastMsg: userLevel.getLastMessageTime(),
      })
      .where(
        and(
          eq(userLevelsInAppPublic.userId, BigInt(userLevel.getUserId())),
          eq(userLevelsInAppPublic.guildId, BigInt(userLevel.getGuildId())),
        ),
      );
  }

  async create(userLevel: UserLevel): Promise<void> {
    await this.db.insert(userLevelsInAppPublic).values({
      userId: BigInt(userLevel.getUserId()),
      guildId: BigInt(userLevel.getGuildId()),
      msgAllTime: BigInt(userLevel.getAllTimeXp()),
      msgMonth: BigInt(userLevel.getMonthXp()),
      msgWeek: BigInt(userLevel.getWeekXp()),
      msgDay: BigInt(userLevel.getDayXp()),
      lastMsg: userLevel.getLastMessageTime(),
    });
  }

  // ---------------------------------------------------------------------------
  // Global levels
  private async getUserGlobalAllMessages(userId: string): Promise<bigint> {
    try {
      const result = await this.db
        .select({
          totalXp: sum(userLevelsInAppPublic.msgAllTime),
        })
        .from(userLevelsInAppPublic)
        .where(eq(userLevelsInAppPublic.userId, BigInt(userId)))
        .groupBy(userLevelsInAppPublic.userId);

      return BigInt(result[0]?.totalXp ?? 0);
    } catch (error) {
      throw new Error(
        `Failed to get global messages for userId ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getUserGlobalLevel(userId: string): Promise<GlobalUserLevel> {
    const globalXp = await this.getUserGlobalAllMessages(userId);
    return GlobalUserLevel.create(userId, globalXp);
  }

  // ---------------------------------------------------------------------------
  // user ranks
  private getOrderByColumn(timeframe: TimeFrame) {
    switch (timeframe) {
      case TimeFrame.DAY:
        return userLevelsInAppPublic.msgDay;
      case TimeFrame.WEEK:
        return userLevelsInAppPublic.msgWeek;
      case TimeFrame.MONTH:
        return userLevelsInAppPublic.msgMonth;
      case TimeFrame.ALL_TIME:
        return userLevelsInAppPublic.msgAllTime;
    }
  }

  private async getPrivateUserCountInTimeframe(
    guildId: string,
    timeframe: TimeFrame,
  ): Promise<number> {
    const conditions = [eq(userLevelsInAppPublic.guildId, BigInt(guildId))];

    switch (timeframe) {
      case TimeFrame.DAY:
        conditions.push(
          sql`extract(doy from ${userLevelsInAppPublic.lastMsg}) = extract(doy from now())`,
          sql`extract(year from ${userLevelsInAppPublic.lastMsg}) = extract(year from now())`,
        );
        break;
      case TimeFrame.WEEK:
        conditions.push(
          sql`extract(week from ${userLevelsInAppPublic.lastMsg}) = extract(week from now())`,
          sql`extract(year from ${userLevelsInAppPublic.lastMsg}) = extract(year from now())`,
        );
        break;
      case TimeFrame.MONTH:
        conditions.push(
          sql`extract(month from ${userLevelsInAppPublic.lastMsg}) = extract(month from now())`,
          sql`extract(year from ${userLevelsInAppPublic.lastMsg}) = extract(year from now())`,
        );
        break;
      case TimeFrame.ALL_TIME:
        // No additional filtering needed
        break;
    }

    const result = await this.db
      // count() automatically maps to Number! If doing a raw sql for COUNT(),
      // it will return string and require manual .mapWith(Number)
      .select({ count: count() })
      .from(userLevelsInAppPublic)
      .where(and(...conditions));

    return result[0]?.count ?? 0;
  }

  private async getUserGuildTimeframeRank(
    guildId: string,
    userId: string,
    timeframe: TimeFrame,
  ): Promise<UserRankData> {
    try {
      // First get total count as it's always returned
      const totalCount = await this.getPrivateUserCountInTimeframe(
        guildId,
        timeframe,
      );

      // Basic check if user has any activity at all
      const user = await this.db
        .select({ lastMsg: userLevelsInAppPublic.lastMsg })
        .from(userLevelsInAppPublic)
        .where(
          and(
            eq(userLevelsInAppPublic.guildId, BigInt(guildId)),
            eq(userLevelsInAppPublic.userId, BigInt(userId)),
          ),
        )
        .limit(1);

      if (!user[0]) {
        // Still want to return the total
        const totalCount = await this.getPrivateUserCountInTimeframe(
          guildId,
          timeframe,
        );

        return {
          rank: null,
          total_count: totalCount,
        };
      }

      // Get user's rank by counting users with higher XP
      const conditions = [eq(userLevelsInAppPublic.guildId, BigInt(guildId))];
      const orderColumn = this.getOrderByColumn(timeframe);

      // Add timeframe conditions
      switch (timeframe) {
        case TimeFrame.DAY:
          conditions.push(
            sql`extract(doy from ${userLevelsInAppPublic.lastMsg}) = extract(doy from now())`,
            sql`extract(year from ${userLevelsInAppPublic.lastMsg}) = extract(year from now())`,
          );
          break;
        case TimeFrame.WEEK:
          conditions.push(
            sql`extract(week from ${userLevelsInAppPublic.lastMsg}) = extract(week from now())`,
            sql`extract(year from ${userLevelsInAppPublic.lastMsg}) = extract(year from now())`,
          );
          break;
        case TimeFrame.MONTH:
          conditions.push(
            sql`extract(month from ${userLevelsInAppPublic.lastMsg}) = extract(month from now())`,
            sql`extract(year from ${userLevelsInAppPublic.lastMsg}) = extract(year from now())`,
          );
          break;
        case TimeFrame.ALL_TIME:
          // No additional conditions
          break;
      }

      // Get the user's XP for this timeframe
      const userXpResult = await this.db
        .select({ xp: orderColumn })
        .from(userLevelsInAppPublic)
        .where(
          and(...conditions, eq(userLevelsInAppPublic.userId, BigInt(userId))),
        )
        .limit(1);

      if (!userXpResult[0]) {
        return {
          rank: null,
          total_count: totalCount,
        };
      }

      const userXp = userXpResult[0].xp;

      // Count users with higher XP or same XP but higher user ID (rank = count + 1)
      const rankResult = await this.db
        // count() automatically maps to Number! If doing a raw sql for COUNT(),
        // it will return string and require manual .mapWith(Number)
        .select({ count: count() })
        .from(userLevelsInAppPublic)
        .where(
          and(
            ...conditions,
            sql`(${orderColumn} > ${userXp} OR (${orderColumn} = ${userXp} AND ${userLevelsInAppPublic.userId} > ${BigInt(userId)}))`,
          ),
        );

      const rank = (rankResult[0]?.count ?? 0) + 1;

      return {
        rank,
        total_count: totalCount,
      };
    } catch (error) {
      throw new Error(
        `Failed to get guild timeframe rank for userId ${userId}, guildId ${guildId}, timeframe ${timeframe}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getUserGuildAllRanks(
    guildId: string,
    userId: string,
  ): Promise<Record<TimeFrame, UserRankData>> {
    const timeframes = [
      TimeFrame.DAY,
      TimeFrame.WEEK,
      TimeFrame.MONTH,
      TimeFrame.ALL_TIME,
    ];

    const ranks = await Promise.all(
      timeframes.map(async (timeframe) => {
        const rank = await this.getUserGuildTimeframeRank(
          guildId,
          userId,
          timeframe,
        );

        return rank;
      }),
    );

    return {
      [TimeFrame.DAY]: ranks[0],
      [TimeFrame.WEEK]: ranks[1],
      [TimeFrame.MONTH]: ranks[2],
      [TimeFrame.ALL_TIME]: ranks[3],
    };
  }

  async getUserGuildRankings(
    guildId: string,
    userId: string,
  ): Promise<UserRank> {
    const rankings = await this.getUserGuildAllRanks(guildId, userId);

    return UserRank.create(userId, guildId, {
      day: {
        rank: rankings[TimeFrame.DAY].rank,
        totalCount: rankings[TimeFrame.DAY].total_count,
      },
      week: {
        rank: rankings[TimeFrame.WEEK].rank,
        totalCount: rankings[TimeFrame.WEEK].total_count,
      },
      month: {
        rank: rankings[TimeFrame.MONTH].rank,
        totalCount: rankings[TimeFrame.MONTH].total_count,
      },
      allTime: {
        rank: rankings[TimeFrame.ALL_TIME].rank,
        totalCount: rankings[TimeFrame.ALL_TIME].total_count,
      },
    });
  }

  async getLeaderboardPage(
    guildId: string,
    timeframe: TimeFrame,
    pageIndex: number,
    pageSize: number,
  ): Promise<LeaderboardEntry[]> {
    try {
      const conditions = [eq(userLevelsInAppPublic.guildId, BigInt(guildId))];
      const orderColumn = this.getOrderByColumn(timeframe);

      // Add timeframe conditions for filtering users
      switch (timeframe) {
        case TimeFrame.DAY:
          conditions.push(
            sql`extract(doy from ${userLevelsInAppPublic.lastMsg}) = extract(doy from now())`,
            sql`extract(year from ${userLevelsInAppPublic.lastMsg}) = extract(year from now())`,
          );
          break;
        case TimeFrame.WEEK:
          conditions.push(
            sql`extract(week from ${userLevelsInAppPublic.lastMsg}) = extract(week from now())`,
            sql`extract(year from ${userLevelsInAppPublic.lastMsg}) = extract(year from now())`,
          );
          break;
        case TimeFrame.MONTH:
          conditions.push(
            sql`extract(month from ${userLevelsInAppPublic.lastMsg}) = extract(month from now())`,
            sql`extract(year from ${userLevelsInAppPublic.lastMsg}) = extract(year from now())`,
          );
          break;
        case TimeFrame.ALL_TIME:
          // No additional conditions
          break;
      }

      const result = await this.db
        .select({
          userId: userLevelsInAppPublic.userId,
          msgAllTime: userLevelsInAppPublic.msgAllTime,
          msgDay: userLevelsInAppPublic.msgDay,
          msgWeek: userLevelsInAppPublic.msgWeek,
          msgMonth: userLevelsInAppPublic.msgMonth,
        })
        .from(userLevelsInAppPublic)
        .where(and(...conditions))
        .orderBy(desc(orderColumn), desc(userLevelsInAppPublic.userId))
        .limit(pageSize)
        .offset(pageIndex * pageSize);

      return result.map((row, index) =>
        LeaderboardEntry.create(
          String(row.userId),
          pageIndex * pageSize + index + 1, // Calculate rank based on position
          row.msgAllTime,
          row.msgDay,
          row.msgWeek,
          row.msgMonth,
        ),
      );
    } catch (error) {
      throw new Error(
        `Failed to get leaderboard page for guildId ${guildId}, timeframe ${timeframe}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getUserCountInTimeframe(
    guildId: string,
    timeframe: TimeFrame,
  ): Promise<number> {
    try {
      const conditions = [eq(userLevelsInAppPublic.guildId, BigInt(guildId))];

      switch (timeframe) {
        case TimeFrame.DAY:
          conditions.push(
            sql`extract(doy from ${userLevelsInAppPublic.lastMsg}) = extract(doy from now())`,
            sql`extract(year from ${userLevelsInAppPublic.lastMsg}) = extract(year from now())`,
          );
          break;
        case TimeFrame.WEEK:
          conditions.push(
            sql`extract(week from ${userLevelsInAppPublic.lastMsg}) = extract(week from now())`,
            sql`extract(year from ${userLevelsInAppPublic.lastMsg}) = extract(year from now())`,
          );
          break;
        case TimeFrame.MONTH:
          conditions.push(
            sql`extract(month from ${userLevelsInAppPublic.lastMsg}) = extract(month from now())`,
            sql`extract(year from ${userLevelsInAppPublic.lastMsg}) = extract(year from now())`,
          );
          break;
        case TimeFrame.ALL_TIME:
          // No additional filtering needed
          break;
      }

      const result = await this.db
        .select({ count: count() })
        .from(userLevelsInAppPublic)
        .where(and(...conditions));

      return result[0]?.count ?? 0;
    } catch (error) {
      throw new Error(
        `Failed to get user count for guildId ${guildId}, timeframe ${timeframe}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
