import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { FOLLOW_UPDATES_ID } from "@/features/prompts/definitions/followUpdates/message";
import {
  guildConfigsInAppPublic,
  guildPromptStatesInAppPublic,
} from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type {
  BackfillCandidate,
  SushiiUpdatesRepository,
} from "../domain/SushiiUpdatesRepository";

const table = guildConfigsInAppPublic;
const promptStates = guildPromptStatesInAppPublic;

const backfillPending = and(
  isNotNull(table.logSushiiNotifications),
  eq(table.logSushiiNotificationsEnabled, true),
  isNull(table.sushiiUpdatesWebhookId),
  isNull(table.sushiiUpdatesBackfilledAt),
  // Dismissing the follow_updates prompt is the server's opt-out.
  sql`NOT EXISTS (SELECT 1 FROM ${promptStates} WHERE ${promptStates.guildId} = ${table.id} AND ${promptStates.promptId} = ${FOLLOW_UPDATES_ID} AND ${promptStates.dismissedAt} IS NOT NULL)`,
);

export class DrizzleSushiiUpdatesRepository implements SushiiUpdatesRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async setWebhookId(guildId: string, webhookId: string | null): Promise<void> {
    const value = webhookId ? BigInt(webhookId) : null;
    await this.db
      .insert(table)
      .values({
        id: BigInt(guildId),
        sushiiUpdatesWebhookId: value,
        sushiiUpdatesBackfilledAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: table.id,
        set: {
          sushiiUpdatesWebhookId: value,
          sushiiUpdatesBackfilledAt: sql`coalesce(${table.sushiiUpdatesBackfilledAt}, now())`,
        },
      });
  }

  async markDecided(guildId: string): Promise<void> {
    await this.db
      .update(table)
      .set({ sushiiUpdatesBackfilledAt: sql`now()` })
      .where(
        and(
          eq(table.id, BigInt(guildId)),
          isNull(table.sushiiUpdatesBackfilledAt),
        ),
      );
  }

  async findBackfillCandidates(): Promise<BackfillCandidate[]> {
    const rows = await this.db
      .select({ id: table.id, channelId: table.logSushiiNotifications })
      .from(table)
      .where(backfillPending);

    return rows.flatMap((row) =>
      row.channelId
        ? [{ guildId: row.id.toString(), channelId: row.channelId.toString() }]
        : [],
    );
  }

  async claimBackfill(guildId: string): Promise<string | null> {
    const [row] = await this.db
      .update(table)
      .set({ sushiiUpdatesBackfilledAt: sql`now()` })
      .where(and(eq(table.id, BigInt(guildId)), backfillPending))
      .returning({ channelId: table.logSushiiNotifications });

    return row?.channelId?.toString() ?? null;
  }
}
