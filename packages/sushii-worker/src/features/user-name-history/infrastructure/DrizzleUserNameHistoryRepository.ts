import { and, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { userNameHistoryInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type {
  NewUserNameHistoryEntry,
  UserNameHistoryEntry,
  UserNameHistoryRepository,
} from "../domain";

const DEFAULT_LIMIT = 50;

export class DrizzleUserNameHistoryRepository
  implements UserNameHistoryRepository
{
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async insertIfChanged(entry: NewUserNameHistoryEntry): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // Check the most recent entry for this (userId, nameType, guildId)
      const guildFilter =
        entry.guildId != null
          ? eq(userNameHistoryInAppPublic.guildId, entry.guildId)
          : isNull(userNameHistoryInAppPublic.guildId);

      const [last] = await tx
        .select({ value: userNameHistoryInAppPublic.value })
        .from(userNameHistoryInAppPublic)
        .where(
          and(
            eq(userNameHistoryInAppPublic.userId, entry.userId),
            eq(userNameHistoryInAppPublic.nameType, entry.nameType),
            guildFilter,
          ),
        )
        .orderBy(desc(userNameHistoryInAppPublic.recordedAt))
        .limit(1);

      if (last !== undefined && last.value === entry.value) {
        return false;
      }

      await tx.insert(userNameHistoryInAppPublic).values(entry);
      return true;
    });
  }

  async findByUserId(
    userId: bigint,
    limit: number = DEFAULT_LIMIT,
  ): Promise<UserNameHistoryEntry[]> {
    return this.db
      .select()
      .from(userNameHistoryInAppPublic)
      .where(eq(userNameHistoryInAppPublic.userId, userId))
      .orderBy(desc(userNameHistoryInAppPublic.recordedAt))
      .limit(limit);
  }
}
