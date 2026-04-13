import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import type { ScheduleChannel } from "@/features/schedule/domain/entities/ScheduleChannel";
import type { ScheduleChannelMessage } from "@/features/schedule/domain/entities/ScheduleChannelMessage";
import type {
  ScheduleChannelRepository,
  UpsertScheduleChannelData,
} from "@/features/schedule/domain/repositories/ScheduleChannelRepository";

type DbType = NodePgDatabase<typeof schema>;

function mapChannel(
  row: typeof schema.scheduleChannelsInAppPublic.$inferSelect,
): ScheduleChannel {
  return {
    guildId: row.guildId,
    channelId: row.channelId,
    logChannelId: row.logChannelId,
    configuredByUserId: row.configuredByUserId,
    calendarId: row.calendarId,
    calendarTitle: row.calendarTitle,
    displayTitle: row.displayTitle,
    syncToken: row.syncToken,
    pollIntervalSec: row.pollIntervalSec,
    nextPollAt: row.nextPollAt,
    consecutiveFailures: row.consecutiveFailures,
    lastErrorAt: row.lastErrorAt,
    lastErrorReason: row.lastErrorReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMessage(
  row: typeof schema.scheduleChannelMessagesInAppPublic.$inferSelect,
): ScheduleChannelMessage {
  return {
    guildId: row.guildId,
    channelId: row.channelId,
    year: row.year,
    month: row.month,
    messageIndex: row.messageIndex,
    messageId: row.messageId,
    contentHash: row.contentHash,
    isArchived: row.isArchived,
    lastUpdatedAt: row.lastUpdatedAt,
  };
}

export class DrizzleScheduleChannelRepository
  implements ScheduleChannelRepository
{
  constructor(
    private readonly db: DbType,
    private readonly logger: Logger,
  ) {}

  async findAllDue(now: Date): Promise<ScheduleChannel[]> {
    const rows = await this.db
      .select()
      .from(schema.scheduleChannelsInAppPublic)
      .where(lte(schema.scheduleChannelsInAppPublic.nextPollAt, now));

    return rows.map(mapChannel);
  }

  async findByChannel(
    guildId: bigint,
    channelId: bigint,
  ): Promise<ScheduleChannel | null> {
    const rows = await this.db
      .select()
      .from(schema.scheduleChannelsInAppPublic)
      .where(
        and(
          eq(schema.scheduleChannelsInAppPublic.guildId, guildId),
          eq(schema.scheduleChannelsInAppPublic.channelId, channelId),
        ),
      )
      .limit(1);

    return rows.length > 0 ? mapChannel(rows[0]) : null;
  }

  async findAllByGuild(guildId: bigint): Promise<ScheduleChannel[]> {
    const rows = await this.db
      .select()
      .from(schema.scheduleChannelsInAppPublic)
      .where(eq(schema.scheduleChannelsInAppPublic.guildId, guildId));

    return rows.map(mapChannel);
  }

  async upsert(data: UpsertScheduleChannelData): Promise<ScheduleChannel> {
    const now = new Date();
    const rows = await this.db
      .insert(schema.scheduleChannelsInAppPublic)
      .values({
        guildId: data.guildId,
        channelId: data.channelId,
        logChannelId: data.logChannelId,
        configuredByUserId: data.configuredByUserId,
        calendarId: data.calendarId,
        calendarTitle: data.calendarTitle,
        displayTitle: data.displayTitle,
        pollIntervalSec: data.pollIntervalSec ?? 120,
        nextPollAt: data.nextPollAt,
        consecutiveFailures: 0,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.scheduleChannelsInAppPublic.guildId,
          schema.scheduleChannelsInAppPublic.channelId,
        ],
        set: {
          logChannelId: data.logChannelId,
          configuredByUserId: data.configuredByUserId,
          calendarId: data.calendarId,
          calendarTitle: data.calendarTitle,
          displayTitle: data.displayTitle,
          pollIntervalSec: data.pollIntervalSec ?? 120,
          nextPollAt: data.nextPollAt,
          syncToken: null,
          consecutiveFailures: 0,
          lastErrorAt: null,
          lastErrorReason: null,
          updatedAt: now,
        },
      })
      .returning();

    return mapChannel(rows[0]);
  }

  async delete(guildId: bigint, channelId: bigint): Promise<void> {
    await this.db
      .delete(schema.scheduleChannelsInAppPublic)
      .where(
        and(
          eq(schema.scheduleChannelsInAppPublic.guildId, guildId),
          eq(schema.scheduleChannelsInAppPublic.channelId, channelId),
        ),
      );
  }

  async updateSyncToken(
    guildId: bigint,
    channelId: bigint,
    syncToken: string | null,
    nextPollAt: Date,
  ): Promise<void> {
    await this.db
      .update(schema.scheduleChannelsInAppPublic)
      .set({ syncToken, nextPollAt, updatedAt: new Date() })
      .where(
        and(
          eq(schema.scheduleChannelsInAppPublic.guildId, guildId),
          eq(schema.scheduleChannelsInAppPublic.channelId, channelId),
        ),
      );
  }

  async recordFailure(
    guildId: bigint,
    channelId: bigint,
    reason: string,
    nextPollAt: Date,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(schema.scheduleChannelsInAppPublic)
      .set({
        consecutiveFailures: sql`${schema.scheduleChannelsInAppPublic.consecutiveFailures} + 1`,
        lastErrorAt: now,
        lastErrorReason: reason,
        nextPollAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.scheduleChannelsInAppPublic.guildId, guildId),
          eq(schema.scheduleChannelsInAppPublic.channelId, channelId),
        ),
      );
  }

  async resetFailures(
    guildId: bigint,
    channelId: bigint,
    nextPollAt: Date,
  ): Promise<void> {
    await this.db
      .update(schema.scheduleChannelsInAppPublic)
      .set({
        consecutiveFailures: 0,
        lastErrorAt: null,
        lastErrorReason: null,
        nextPollAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.scheduleChannelsInAppPublic.guildId, guildId),
          eq(schema.scheduleChannelsInAppPublic.channelId, channelId),
        ),
      );
  }

  async getMessages(
    guildId: bigint,
    channelId: bigint,
    year: number,
    month: number,
  ): Promise<ScheduleChannelMessage[]> {
    const rows = await this.db
      .select()
      .from(schema.scheduleChannelMessagesInAppPublic)
      .where(
        and(
          eq(schema.scheduleChannelMessagesInAppPublic.guildId, guildId),
          eq(schema.scheduleChannelMessagesInAppPublic.channelId, channelId),
          eq(schema.scheduleChannelMessagesInAppPublic.year, year),
          eq(schema.scheduleChannelMessagesInAppPublic.month, month),
        ),
      )
      .orderBy(asc(schema.scheduleChannelMessagesInAppPublic.messageIndex));

    return rows.map(mapMessage);
  }

  async upsertMessage(
    guildId: bigint,
    channelId: bigint,
    year: number,
    month: number,
    messageIndex: number,
    messageId: bigint,
    contentHash: string,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .insert(schema.scheduleChannelMessagesInAppPublic)
      .values({
        guildId,
        channelId,
        year,
        month,
        messageIndex,
        messageId,
        contentHash,
        isArchived: false,
        lastUpdatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.scheduleChannelMessagesInAppPublic.guildId,
          schema.scheduleChannelMessagesInAppPublic.channelId,
          schema.scheduleChannelMessagesInAppPublic.year,
          schema.scheduleChannelMessagesInAppPublic.month,
          schema.scheduleChannelMessagesInAppPublic.messageIndex,
        ],
        set: {
          messageId,
          contentHash,
          lastUpdatedAt: now,
        },
      });
  }

  async deleteMessagesAboveIndex(
    guildId: bigint,
    channelId: bigint,
    year: number,
    month: number,
    maxIndex: number,
  ): Promise<void> {
    await this.db
      .delete(schema.scheduleChannelMessagesInAppPublic)
      .where(
        and(
          eq(schema.scheduleChannelMessagesInAppPublic.guildId, guildId),
          eq(schema.scheduleChannelMessagesInAppPublic.channelId, channelId),
          eq(schema.scheduleChannelMessagesInAppPublic.year, year),
          eq(schema.scheduleChannelMessagesInAppPublic.month, month),
          gt(schema.scheduleChannelMessagesInAppPublic.messageIndex, maxIndex),
        ),
      );
  }

  async markArchived(
    guildId: bigint,
    channelId: bigint,
    year: number,
    month: number,
  ): Promise<void> {
    await this.db
      .update(schema.scheduleChannelMessagesInAppPublic)
      .set({ isArchived: true })
      .where(
        and(
          eq(schema.scheduleChannelMessagesInAppPublic.guildId, guildId),
          eq(schema.scheduleChannelMessagesInAppPublic.channelId, channelId),
          eq(schema.scheduleChannelMessagesInAppPublic.year, year),
          eq(schema.scheduleChannelMessagesInAppPublic.month, month),
        ),
      );
  }

  async clearContentHashes(
    guildId: bigint,
    channelId: bigint,
    year: number,
    month: number,
  ): Promise<void> {
    await this.db
      .update(schema.scheduleChannelMessagesInAppPublic)
      .set({ contentHash: "" })
      .where(
        and(
          eq(schema.scheduleChannelMessagesInAppPublic.guildId, guildId),
          eq(schema.scheduleChannelMessagesInAppPublic.channelId, channelId),
          eq(schema.scheduleChannelMessagesInAppPublic.year, year),
          eq(schema.scheduleChannelMessagesInAppPublic.month, month),
        ),
      );
  }
}
