import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/infrastructure/database/schema";

import type { PromptStateData } from "../domain/PromptState";
import type { PromptStateRepository } from "../domain/repositories/PromptStateRepository";

type DbType = NodePgDatabase<typeof schema>;

const table = schema.guildPromptStatesInAppPublic;

export class DrizzlePromptStateRepository implements PromptStateRepository {
  constructor(private readonly db: DbType) {}

  async findByGuildAndPrompt(
    guildId: bigint,
    promptId: string,
  ): Promise<PromptStateData | null> {
    const results = await this.db
      .select()
      .from(table)
      .where(and(eq(table.guildId, guildId), eq(table.promptId, promptId)))
      .limit(1);
    return results[0] ?? null;
  }

  async claimPromptSlot(
    guildId: bigint,
    promptId: string,
    cooldownThreshold: Date | null,
  ): Promise<boolean> {
    const now = new Date();

    // setWhere condition: only update lastPromptedAt if it's null (never shown)
    // or before the cooldown threshold. This is atomic at the DB level — if two
    // concurrent callers race here, only one wins and the other returns false.
    const setWhere = cooldownThreshold
      ? sql`${table.lastPromptedAt} IS NULL OR ${table.lastPromptedAt} < ${cooldownThreshold}`
      : sql`${table.lastPromptedAt} IS NULL`;

    const result = await this.db
      .insert(table)
      .values({ guildId, promptId, lastPromptedAt: now })
      .onConflictDoUpdate({
        target: [table.guildId, table.promptId],
        set: { lastPromptedAt: now },
        setWhere,
      })
      .returning({ guildId: table.guildId });

    return result.length > 0;
  }

  async recordSnoozed(
    guildId: bigint,
    promptId: string,
    snoozeUntil: Date,
  ): Promise<void> {
    await this.db
      .insert(table)
      .values({ guildId, promptId, snoozeUntil })
      .onConflictDoUpdate({
        target: [table.guildId, table.promptId],
        set: { snoozeUntil },
      });
  }

  async recordDismissed(guildId: bigint, promptId: string): Promise<void> {
    const dismissedAt = new Date();
    await this.db
      .insert(table)
      .values({ guildId, promptId, dismissedAt })
      .onConflictDoUpdate({
        target: [table.guildId, table.promptId],
        set: { dismissedAt },
      });
  }

  async recordCompleted(guildId: bigint, promptId: string): Promise<void> {
    const completedAt = new Date();
    await this.db
      .insert(table)
      .values({ guildId, promptId, completedAt })
      .onConflictDoUpdate({
        target: [table.guildId, table.promptId],
        set: { completedAt },
      });
  }
}
