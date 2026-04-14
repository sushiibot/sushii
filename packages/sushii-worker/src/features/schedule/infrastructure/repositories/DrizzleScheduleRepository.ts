import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import type { Schedule } from "@/features/schedule/domain/entities/Schedule";
import type { ScheduleMessage } from "@/features/schedule/domain/entities/ScheduleMessage";
import { ScheduleEvent } from "@/features/schedule/domain/entities/ScheduleEvent";
import type {
  ScheduleRepository,
  UpsertScheduleData,
} from "@/features/schedule/domain/repositories/ScheduleRepository";
import type { ScheduleMessageRepository } from "@/features/schedule/domain/repositories/ScheduleMessageRepository";
import type {
  ScheduleEventRepository,
  ScheduleEventWithCalendar,
} from "@/features/schedule/domain/repositories/ScheduleEventRepository";

type DbType = NodePgDatabase<typeof schema>;

function mapSchedule(row: typeof schema.schedulesInAppPublic.$inferSelect): Schedule {
  return {
    guildId: row.guildId,
    calendarId: row.calendarId,
    channelId: row.channelId,
    logChannelId: row.logChannelId,
    configuredByUserId: row.configuredByUserId,
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

function mapMessage(row: typeof schema.scheduleMessagesInAppPublic.$inferSelect): ScheduleMessage {
  return {
    guildId: row.guildId,
    calendarId: row.calendarId,
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

function mapEvent(row: typeof schema.scheduleEventsInAppPublic.$inferSelect): ScheduleEvent {
  return new ScheduleEvent(
    row.eventId,
    row.summary,
    row.startUtc ?? null,
    row.startDate ?? null,
    row.isAllDay,
    row.url ?? null,
    row.location ?? null,
    (row.status as "confirmed" | "tentative" | "cancelled") ?? "confirmed",
  );
}

export class DrizzleScheduleRepository
  implements ScheduleRepository, ScheduleMessageRepository, ScheduleEventRepository
{
  constructor(
    private readonly db: DbType,
    private readonly logger: Logger,
  ) {}

  // ── ScheduleRepository ────────────────────────────────────────────────────

  async findAllDue(now: Date): Promise<Schedule[]> {
    const rows = await this.db
      .select()
      .from(schema.schedulesInAppPublic)
      .where(lte(schema.schedulesInAppPublic.nextPollAt, now));
    return rows.map(mapSchedule);
  }

  async findByChannel(guildId: bigint, channelId: bigint): Promise<Schedule | null> {
    const rows = await this.db
      .select()
      .from(schema.schedulesInAppPublic)
      .where(
        and(
          eq(schema.schedulesInAppPublic.guildId, guildId),
          eq(schema.schedulesInAppPublic.channelId, channelId),
        ),
      )
      .limit(1);
    return rows.length > 0 ? mapSchedule(rows[0]) : null;
  }

  async findByCalendar(guildId: bigint, calendarId: string): Promise<Schedule | null> {
    const rows = await this.db
      .select()
      .from(schema.schedulesInAppPublic)
      .where(
        and(
          eq(schema.schedulesInAppPublic.guildId, guildId),
          eq(schema.schedulesInAppPublic.calendarId, calendarId),
        ),
      )
      .limit(1);
    return rows.length > 0 ? mapSchedule(rows[0]) : null;
  }

  async findAllByGuild(guildId: bigint): Promise<Schedule[]> {
    const rows = await this.db
      .select()
      .from(schema.schedulesInAppPublic)
      .where(eq(schema.schedulesInAppPublic.guildId, guildId));
    return rows.map(mapSchedule);
  }

  async upsert(data: UpsertScheduleData): Promise<Schedule> {
    const now = new Date();
    const rows = await this.db
      .insert(schema.schedulesInAppPublic)
      .values({
        guildId: data.guildId,
        calendarId: data.calendarId,
        channelId: data.channelId,
        logChannelId: data.logChannelId,
        configuredByUserId: data.configuredByUserId,
        calendarTitle: data.calendarTitle,
        displayTitle: data.displayTitle ?? null,
        pollIntervalSec: data.pollIntervalSec ?? 120,
        nextPollAt: data.nextPollAt,
        consecutiveFailures: 0,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.schedulesInAppPublic.guildId, schema.schedulesInAppPublic.calendarId],
        set: {
          channelId: data.channelId,
          logChannelId: data.logChannelId,
          configuredByUserId: data.configuredByUserId,
          calendarTitle: data.calendarTitle,
          ...(data.displayTitle !== undefined ? { displayTitle: data.displayTitle } : {}),
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
    return mapSchedule(rows[0]);
  }

  async delete(guildId: bigint, calendarId: string): Promise<void> {
    await this.db
      .delete(schema.schedulesInAppPublic)
      .where(
        and(
          eq(schema.schedulesInAppPublic.guildId, guildId),
          eq(schema.schedulesInAppPublic.calendarId, calendarId),
        ),
      );
  }

  async updateSyncToken(
    guildId: bigint,
    calendarId: string,
    syncToken: string | null,
    nextPollAt: Date,
  ): Promise<void> {
    await this.db
      .update(schema.schedulesInAppPublic)
      .set({ syncToken, nextPollAt, updatedAt: new Date() })
      .where(
        and(
          eq(schema.schedulesInAppPublic.guildId, guildId),
          eq(schema.schedulesInAppPublic.calendarId, calendarId),
        ),
      );
  }

  async recordFailure(
    guildId: bigint,
    calendarId: string,
    reason: string,
    nextPollAt: Date,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(schema.schedulesInAppPublic)
      .set({
        consecutiveFailures: sql`${schema.schedulesInAppPublic.consecutiveFailures} + 1`,
        lastErrorAt: now,
        lastErrorReason: reason,
        nextPollAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.schedulesInAppPublic.guildId, guildId),
          eq(schema.schedulesInAppPublic.calendarId, calendarId),
        ),
      );
  }

  async resetFailuresAndUpdateToken(
    guildId: bigint,
    calendarId: string,
    syncToken: string | null,
    nextPollAt: Date,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(schema.schedulesInAppPublic)
      .set({
        consecutiveFailures: 0,
        lastErrorAt: null,
        lastErrorReason: null,
        syncToken,
        nextPollAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.schedulesInAppPublic.guildId, guildId),
          eq(schema.schedulesInAppPublic.calendarId, calendarId),
        ),
      );
  }

  // ── ScheduleMessageRepository ─────────────────────────────────────────────

  async getMessages(
    guildId: bigint,
    calendarId: string,
    year: number,
    month: number,
  ): Promise<ScheduleMessage[]> {
    const rows = await this.db
      .select()
      .from(schema.scheduleMessagesInAppPublic)
      .where(
        and(
          eq(schema.scheduleMessagesInAppPublic.guildId, guildId),
          eq(schema.scheduleMessagesInAppPublic.calendarId, calendarId),
          eq(schema.scheduleMessagesInAppPublic.year, year),
          eq(schema.scheduleMessagesInAppPublic.month, month),
        ),
      )
      .orderBy(asc(schema.scheduleMessagesInAppPublic.messageIndex));
    return rows.map(mapMessage);
  }

  async upsertMessage(
    guildId: bigint,
    calendarId: string,
    channelId: bigint,
    year: number,
    month: number,
    messageIndex: number,
    messageId: bigint,
    contentHash: string,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .insert(schema.scheduleMessagesInAppPublic)
      .values({
        guildId,
        calendarId,
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
          schema.scheduleMessagesInAppPublic.guildId,
          schema.scheduleMessagesInAppPublic.calendarId,
          schema.scheduleMessagesInAppPublic.year,
          schema.scheduleMessagesInAppPublic.month,
          schema.scheduleMessagesInAppPublic.messageIndex,
        ],
        set: { channelId, messageId, contentHash, lastUpdatedAt: now },
      });
  }

  async deleteMessagesAboveIndex(
    guildId: bigint,
    calendarId: string,
    year: number,
    month: number,
    maxIndex: number,
  ): Promise<void> {
    await this.db
      .delete(schema.scheduleMessagesInAppPublic)
      .where(
        and(
          eq(schema.scheduleMessagesInAppPublic.guildId, guildId),
          eq(schema.scheduleMessagesInAppPublic.calendarId, calendarId),
          eq(schema.scheduleMessagesInAppPublic.year, year),
          eq(schema.scheduleMessagesInAppPublic.month, month),
          gt(schema.scheduleMessagesInAppPublic.messageIndex, maxIndex),
        ),
      );
  }

  async markArchived(
    guildId: bigint,
    calendarId: string,
    year: number,
    month: number,
  ): Promise<void> {
    await this.db
      .update(schema.scheduleMessagesInAppPublic)
      .set({ isArchived: true })
      .where(
        and(
          eq(schema.scheduleMessagesInAppPublic.guildId, guildId),
          eq(schema.scheduleMessagesInAppPublic.calendarId, calendarId),
          eq(schema.scheduleMessagesInAppPublic.year, year),
          eq(schema.scheduleMessagesInAppPublic.month, month),
        ),
      );
  }

  async clearContentHashes(
    guildId: bigint,
    calendarId: string,
    year: number,
    month: number,
  ): Promise<void> {
    await this.db
      .update(schema.scheduleMessagesInAppPublic)
      .set({ contentHash: "" })
      .where(
        and(
          eq(schema.scheduleMessagesInAppPublic.guildId, guildId),
          eq(schema.scheduleMessagesInAppPublic.calendarId, calendarId),
          eq(schema.scheduleMessagesInAppPublic.year, year),
          eq(schema.scheduleMessagesInAppPublic.month, month),
        ),
      );
  }

  // ── ScheduleEventRepository ───────────────────────────────────────────────

  async upsertMany(
    guildId: bigint,
    calendarId: string,
    events: ScheduleEvent[],
  ): Promise<void> {
    if (events.length === 0) return;
    await this.db
      .insert(schema.scheduleEventsInAppPublic)
      .values(
        events.map((e) => ({
          guildId,
          calendarId,
          eventId: e.id,
          summary: e.summary,
          startUtc: e.startUtc,
          startDate: e.startDate,
          isAllDay: e.isAllDay,
          url: e.url,
          location: e.location,
          status: e.status,
        })),
      )
      .onConflictDoUpdate({
        target: [
          schema.scheduleEventsInAppPublic.guildId,
          schema.scheduleEventsInAppPublic.calendarId,
          schema.scheduleEventsInAppPublic.eventId,
        ],
        set: {
          summary: sql`excluded.summary`,
          startUtc: sql`excluded.start_utc`,
          startDate: sql`excluded.start_date`,
          isAllDay: sql`excluded.is_all_day`,
          url: sql`excluded.url`,
          location: sql`excluded.location`,
          status: sql`excluded.status`,
        },
      });
  }

  async deleteByIds(
    guildId: bigint,
    calendarId: string,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .delete(schema.scheduleEventsInAppPublic)
      .where(
        and(
          eq(schema.scheduleEventsInAppPublic.guildId, guildId),
          eq(schema.scheduleEventsInAppPublic.calendarId, calendarId),
          inArray(schema.scheduleEventsInAppPublic.eventId, ids),
        ),
      );
  }

  async replaceAllEvents(
    guildId: bigint,
    calendarId: string,
    events: ScheduleEvent[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.scheduleEventsInAppPublic)
        .where(
          and(
            eq(schema.scheduleEventsInAppPublic.guildId, guildId),
            eq(schema.scheduleEventsInAppPublic.calendarId, calendarId),
          ),
        );
      if (events.length > 0) {
        await tx
          .insert(schema.scheduleEventsInAppPublic)
          .values(
            events.map((e) => ({
              guildId,
              calendarId,
              eventId: e.id,
              summary: e.summary,
              startUtc: e.startUtc,
              startDate: e.startDate,
              isAllDay: e.isAllDay,
              url: e.url,
              location: e.location,
              status: e.status,
            })),
          )
          .onConflictDoUpdate({
            target: [
              schema.scheduleEventsInAppPublic.guildId,
              schema.scheduleEventsInAppPublic.calendarId,
              schema.scheduleEventsInAppPublic.eventId,
            ],
            set: {
              summary: sql`excluded.summary`,
              startUtc: sql`excluded.start_utc`,
              startDate: sql`excluded.start_date`,
              isAllDay: sql`excluded.is_all_day`,
              url: sql`excluded.url`,
              location: sql`excluded.location`,
              status: sql`excluded.status`,
            },
          });
      }
    });
  }

  async findEventsByCalendar(
    guildId: bigint,
    calendarId: string,
    from: Date,
    to: Date,
  ): Promise<ScheduleEvent[]> {
    const fromDateStr = from.toISOString().slice(0, 10);
    const toDateStr = to.toISOString().slice(0, 10);
    const rows = await this.db
      .select()
      .from(schema.scheduleEventsInAppPublic)
      .where(
        and(
          eq(schema.scheduleEventsInAppPublic.guildId, guildId),
          eq(schema.scheduleEventsInAppPublic.calendarId, calendarId),
          or(
            // Timed events: filter by start_utc
            and(
              isNotNull(schema.scheduleEventsInAppPublic.startUtc),
              gte(schema.scheduleEventsInAppPublic.startUtc, from),
              lt(schema.scheduleEventsInAppPublic.startUtc, to),
            ),
            // All-day events: filter by start_date (text, YYYY-MM-DD)
            and(
              isNull(schema.scheduleEventsInAppPublic.startUtc),
              isNotNull(schema.scheduleEventsInAppPublic.startDate),
              gte(schema.scheduleEventsInAppPublic.startDate, fromDateStr),
              lt(schema.scheduleEventsInAppPublic.startDate, toDateStr),
            ),
          ),
        ),
      )
      .orderBy(
        asc(
          sql`COALESCE(${schema.scheduleEventsInAppPublic.startUtc}, (${schema.scheduleEventsInAppPublic.startDate} || 'T00:00:00Z')::timestamptz)`,
        ),
      );
    return rows.map(mapEvent);
  }

  async findUpcomingByGuild(
    guildId: bigint,
    from: Date,
    to: Date,
  ): Promise<ScheduleEventWithCalendar[]> {
    const fromDateStr = from.toISOString().slice(0, 10);
    const toDateStr = to.toISOString().slice(0, 10);
    const rows = await this.db
      .select({
        event: schema.scheduleEventsInAppPublic,
        calendarId: schema.schedulesInAppPublic.calendarId,
        calendarTitle: schema.schedulesInAppPublic.calendarTitle,
      })
      .from(schema.scheduleEventsInAppPublic)
      .innerJoin(
        schema.schedulesInAppPublic,
        and(
          eq(schema.scheduleEventsInAppPublic.guildId, schema.schedulesInAppPublic.guildId),
          eq(schema.scheduleEventsInAppPublic.calendarId, schema.schedulesInAppPublic.calendarId),
        ),
      )
      .where(
        and(
          eq(schema.scheduleEventsInAppPublic.guildId, guildId),
          or(
            // Timed events: filter by start_utc
            and(
              isNotNull(schema.scheduleEventsInAppPublic.startUtc),
              gte(schema.scheduleEventsInAppPublic.startUtc, from),
              lt(schema.scheduleEventsInAppPublic.startUtc, to),
            ),
            // All-day events: filter by start_date (text, YYYY-MM-DD)
            and(
              isNull(schema.scheduleEventsInAppPublic.startUtc),
              isNotNull(schema.scheduleEventsInAppPublic.startDate),
              gte(schema.scheduleEventsInAppPublic.startDate, fromDateStr),
              lt(schema.scheduleEventsInAppPublic.startDate, toDateStr),
            ),
          ),
        ),
      )
      .orderBy(
        asc(
          sql`COALESCE(${schema.scheduleEventsInAppPublic.startUtc}, (${schema.scheduleEventsInAppPublic.startDate} || 'T00:00:00Z')::timestamptz)`,
        ),
      );

    return rows.map((row) => ({
      event: mapEvent(row.event),
      calendarId: row.calendarId,
      calendarTitle: row.calendarTitle,
    }));
  }
}
