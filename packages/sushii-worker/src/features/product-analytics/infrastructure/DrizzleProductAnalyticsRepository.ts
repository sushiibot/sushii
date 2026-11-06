import { and, asc, eq, gte, lt, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/infrastructure/database/schema";

import type {
  ProductAnalyticsRepository,
  ProductRollupTransaction,
  UserDataDeletion,
} from "../domain/ProductAnalyticsRepository";
import {
  ALL_FEATURES,
  type ProductEventRow,
  UNMATCHED_FEATURE,
} from "../domain/ProductEvent";
import type { FeatureUnit } from "../domain/features";
import {
  RETENTION_WEEKS_LATER,
  type RetentionCell,
  type RetentionCounts,
  type UsageCell,
  type UsageCounts,
} from "../domain/rollup";

const {
  productEventsInAppPublic: events,
  productUsageWeeklyInAppPublic: usageWeekly,
  productRetentionWeeklyInAppPublic: retentionWeekly,
  productRollupStateInAppPublic: rollupState,
  feedbackInAppPublic: feedback,
  userPromptStatesInAppPublic: userPromptStates,
} = schema;

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const ROLLUP_LOCK_KEY = 7_203_114;

const eventWeek = sql`date_trunc('week', ${events.occurredAt} AT TIME ZONE 'UTC')`;

function asDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function asUtcDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

async function oldestEventAt(db: Db | Tx): Promise<Date | null> {
  const [row] = await db
    .select({ occurredAt: events.occurredAt })
    .from(events)
    .orderBy(asc(events.occurredAt))
    .limit(1);
  return row?.occurredAt ?? null;
}

class DrizzleRollupTransaction implements ProductRollupTransaction {
  constructor(private readonly tx: Tx) {}

  oldestEventAt(): Promise<Date | null> {
    return oldestEventAt(this.tx);
  }

  async getWatermark(): Promise<Date | null> {
    const [row] = await this.tx.select().from(rollupState).limit(1);
    return row ? asUtcDate(row.watermark) : null;
  }

  async setWatermark(week: Date): Promise<void> {
    const watermark = asDateString(week);
    await this.tx
      .insert(rollupState)
      .values({ watermark })
      .onConflictDoUpdate({ target: rollupState.id, set: { watermark } });
  }

  async usageCounts(from: Date, to: Date): Promise<UsageCounts[]> {
    if (from >= to) {
      return [];
    }
    const range = and(gte(events.occurredAt, from), lt(events.occurredAt, to));
    const columns = {
      week: sql<string>`to_char(${eventWeek}, 'YYYY-MM-DD')`,
      guilds: sql<number>`count(DISTINCT ${events.guildId})::int`,
      actors: sql<number>`count(DISTINCT ${events.actor})::int`,
      events: sql<number>`count(*)::int`,
    };

    const perFeature = await this.tx
      .select({ ...columns, feature: events.feature })
      .from(events)
      .where(range)
      .groupBy(eventWeek, events.feature);

    const all = await this.tx
      .select(columns)
      .from(events)
      .where(and(range, ne(events.feature, UNMATCHED_FEATURE)))
      .groupBy(eventWeek);

    return [
      ...perFeature,
      ...all.map((row) => ({ ...row, feature: ALL_FEATURES })),
    ].map((row) => ({ ...row, week: asUtcDate(row.week) }));
  }

  async retentionCounts(from: Date, to: Date): Promise<RetentionCounts[]> {
    if (from >= to) {
      return [];
    }
    const offsets = sql.join(
      RETENTION_WEEKS_LATER.map((n) => sql`(${n}::int)`),
      sql`, `,
    );

    const result = await this.tx.execute<{
      cohort_week: string;
      unit: FeatureUnit;
      feature: string;
      weeks_later: number;
      base: number;
      retained: number;
    }>(sql`
      WITH source AS (
        SELECT
          date_trunc('week', occurred_at AT TIME ZONE 'UTC')::date AS week,
          feature,
          actor,
          guild_id
        FROM app_public.product_events
        WHERE occurred_at >= ${from.toISOString()}::timestamptz
          AND occurred_at < ${to.toISOString()}::timestamptz
          AND feature <> ${UNMATCHED_FEATURE}
      ),
      activity AS (
        SELECT DISTINCT week, 'user' AS unit, feature, encode(actor, 'hex') AS id
          FROM source WHERE actor IS NOT NULL
        UNION
        SELECT DISTINCT week, 'guild', feature, guild_id::text
          FROM source WHERE guild_id IS NOT NULL
        UNION
        SELECT DISTINCT week, 'user', ${ALL_FEATURES}, encode(actor, 'hex')
          FROM source WHERE actor IS NOT NULL
        UNION
        SELECT DISTINCT week, 'guild', ${ALL_FEATURES}, guild_id::text
          FROM source WHERE guild_id IS NOT NULL
      ),
      cohorts AS (
        SELECT week, unit, feature, count(*)::int AS base
        FROM activity
        GROUP BY week, unit, feature
      ),
      offsets (weeks_later) AS (VALUES ${offsets})
      SELECT
        to_char(c.week, 'YYYY-MM-DD') AS cohort_week,
        c.unit,
        c.feature,
        o.weeks_later,
        c.base,
        (
          SELECT count(*)::int
          FROM activity a
          JOIN activity b
            ON b.unit = a.unit AND b.feature = a.feature AND b.id = a.id
          WHERE a.week = c.week AND a.unit = c.unit AND a.feature = c.feature
            AND b.week = c.week + o.weeks_later * 7
        ) AS retained
      FROM cohorts c
      CROSS JOIN offsets o
      WHERE c.week + o.weeks_later * 7 < ${asDateString(to)}::date
    `);

    return result.rows.map((row) => ({
      cohortWeek: asUtcDate(row.cohort_week),
      unit: row.unit,
      feature: row.feature,
      weeksLater: row.weeks_later,
      base: row.base,
      retained: row.retained,
    }));
  }

  async upsertUsage(cells: UsageCell[]): Promise<void> {
    if (cells.length === 0) {
      return;
    }
    await this.tx
      .insert(usageWeekly)
      .values(cells.map((cell) => ({ ...cell, week: asDateString(cell.week) })))
      .onConflictDoUpdate({
        target: [usageWeekly.week, usageWeekly.feature],
        set: {
          guilds: sql`excluded.guilds`,
          actors: sql`excluded.actors`,
          events: sql`excluded.events`,
        },
      });
  }

  async upsertRetention(cells: RetentionCell[]): Promise<void> {
    if (cells.length === 0) {
      return;
    }
    await this.tx
      .insert(retentionWeekly)
      .values(
        cells.map((cell) => ({
          ...cell,
          cohortWeek: asDateString(cell.cohortWeek),
        })),
      )
      .onConflictDoUpdate({
        target: [
          retentionWeekly.cohortWeek,
          retentionWeekly.unit,
          retentionWeekly.feature,
          retentionWeekly.weeksLater,
        ],
        set: {
          base: sql`excluded.base`,
          retained: sql`excluded.retained`,
        },
      });
  }
}

export class DrizzleProductAnalyticsRepository
  implements ProductAnalyticsRepository
{
  constructor(private readonly db: Db) {}

  async insert(event: ProductEventRow): Promise<void> {
    await this.db.insert(events).values(event);
  }

  async withRollupLock(
    work: (tx: ProductRollupTransaction) => Promise<void>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const result = await tx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(${ROLLUP_LOCK_KEY}) AS locked`,
      );
      if (!result.rows[0]?.locked) {
        return;
      }
      await work(new DrizzleRollupTransaction(tx));
    });
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const deleted = await this.db
      .delete(events)
      .where(lt(events.occurredAt, cutoff))
      .returning({ id: events.id });
    return deleted.length;
  }

  oldestEventAt(): Promise<Date | null> {
    return oldestEventAt(this.db);
  }

  async deleteUserData(
    userId: string,
    actor: Buffer,
  ): Promise<UserDataDeletion> {
    const id = BigInt(userId);
    return this.db.transaction(async (tx) => {
      const usageRecords = await tx
        .delete(events)
        .where(eq(events.actor, actor))
        .returning({ id: events.id });
      const feedbackRows = await tx
        .delete(feedback)
        .where(eq(feedback.userId, id))
        .returning({ id: feedback.id });
      const promptRows = await tx
        .delete(userPromptStates)
        .where(eq(userPromptStates.userId, id))
        .returning({ promptId: userPromptStates.promptId });

      return {
        usageRecords: usageRecords.length,
        feedback: feedbackRows.length,
        promptStates: promptRows.length,
      };
    });
  }
}
