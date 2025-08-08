import {
  and,
  count,
  eq,
  exists,
  inArray,
  like,
  ne,
  not,
  or,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  notificationBlocksInAppPublic,
  notificationsInAppPublic,
} from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import { Notification } from "../domain/entities/Notification";
import type { NotificationRepository } from "../domain/repositories/NotificationRepository";
import { extractKeywords } from "../domain/services/MessageParser";

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async add(notification: Notification): Promise<boolean> {
    const result = await this.db
      .insert(notificationsInAppPublic)
      .values({
        guildId: BigInt(notification.guildId),
        userId: BigInt(notification.userId),
        keyword: notification.cleanedKeyword,
      })
      .onConflictDoNothing({
        target: [
          notificationsInAppPublic.guildId,
          notificationsInAppPublic.userId,
          notificationsInAppPublic.keyword,
        ],
      });

    return (result.rowCount ?? 0) > 0;
  }

  async findByUserAndGuild(
    guildId: string,
    userId: string,
  ): Promise<Notification[]> {
    const rows = await this.db
      .select()
      .from(notificationsInAppPublic)
      .where(
        and(
          eq(notificationsInAppPublic.guildId, BigInt(guildId)),
          eq(notificationsInAppPublic.userId, BigInt(userId)),
        ),
      );

    return rows.map(
      (row) =>
        new Notification(
          row.guildId.toString(),
          row.userId.toString(),
          row.keyword,
        ),
    );
  }

  async findByUserGuildAndKeyword(
    guildId: string,
    userId: string,
    keyword: string,
  ): Promise<Notification | null> {
    const row = await this.db
      .select()
      .from(notificationsInAppPublic)
      .where(
        and(
          eq(notificationsInAppPublic.guildId, BigInt(guildId)),
          eq(notificationsInAppPublic.userId, BigInt(userId)),
          eq(notificationsInAppPublic.keyword, keyword.toLowerCase().trim()),
        ),
      )
      .limit(1);

    return row.length > 0
      ? new Notification(
          row[0].guildId.toString(),
          row[0].userId.toString(),
          row[0].keyword,
        )
      : null;
  }

  async searchByUserAndGuild(
    guildId: string,
    userId: string,
    query: string,
  ): Promise<Notification[]> {
    const escaped = query.replace(/[%_]/g, "\\$&");

    const rows = await this.db
      .select()
      .from(notificationsInAppPublic)
      .where(
        and(
          eq(notificationsInAppPublic.guildId, BigInt(guildId)),
          eq(notificationsInAppPublic.userId, BigInt(userId)),
          like(notificationsInAppPublic.keyword, `${escaped}%`),
        ),
      )
      .limit(25);

    return rows.map(
      (row) =>
        new Notification(
          row.guildId.toString(),
          row.userId.toString(),
          row.keyword,
        ),
    );
  }

  async delete(
    guildId: string,
    userId: string,
    keyword: string,
  ): Promise<boolean> {
    const result = await this.db
      .delete(notificationsInAppPublic)
      .where(
        and(
          eq(notificationsInAppPublic.guildId, BigInt(guildId)),
          eq(notificationsInAppPublic.userId, BigInt(userId)),
          eq(notificationsInAppPublic.keyword, keyword.toLowerCase().trim()),
        ),
      );

    return (result.rowCount ?? 0) > 0;
  }

  async deleteByUser(guildId: string, userId: string): Promise<void> {
    await this.db
      .delete(notificationsInAppPublic)
      .where(
        and(
          eq(notificationsInAppPublic.guildId, BigInt(guildId)),
          eq(notificationsInAppPublic.userId, BigInt(userId)),
        ),
      );
  }

  async findMatchingNotifications(
    guildId: string,
    channelCategoryId: string | null,
    channelId: string,
    authorId: string,
    messageContent: string,
  ): Promise<Notification[]> {
    const keywords = extractKeywords(messageContent);

    const blockConditions = [
      eq(notificationBlocksInAppPublic.blockId, BigInt(authorId)),
      eq(notificationBlocksInAppPublic.blockId, BigInt(channelId)),
    ];

    if (channelCategoryId !== null) {
      blockConditions.push(
        eq(notificationBlocksInAppPublic.blockId, BigInt(channelCategoryId)),
      );
    }

    const rows = await this.db
      .select()
      .from(notificationsInAppPublic)
      .where(
        and(
          eq(notificationsInAppPublic.guildId, BigInt(guildId)),
          ne(notificationsInAppPublic.userId, BigInt(authorId)),
          inArray(notificationsInAppPublic.keyword, keywords),
          not(
            exists(
              this.db
                .select()
                .from(notificationBlocksInAppPublic)
                .where(
                  and(
                    eq(
                      notificationBlocksInAppPublic.userId,
                      notificationsInAppPublic.userId,
                    ),
                    or(...blockConditions),
                  ),
                ),
            ),
          ),
        ),
      );

    return rows.map(
      (row) =>
        new Notification(
          row.guildId.toString(),
          row.userId.toString(),
          row.keyword,
        ),
    );
  }

  async getTotalCount(): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(notificationsInAppPublic);

    return Number(result[0].count);
  }
}
