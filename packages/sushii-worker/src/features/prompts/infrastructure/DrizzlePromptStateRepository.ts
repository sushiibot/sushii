import { and, eq, max, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/infrastructure/database/schema";

import type { PromptStateData, PromptSubject } from "../domain/PromptState";
import type { PromptStateRepository } from "../domain/repositories/PromptStateRepository";

type DbType = NodePgDatabase<typeof schema>;

const guildTable = schema.guildPromptStatesInAppPublic;
const userTable = schema.userPromptStatesInAppPublic;

interface StateFields {
  lastPromptedAt?: Date | null;
  snoozeUntil?: Date;
  dismissedAt?: Date;
  completedAt?: Date;
}

export class DrizzlePromptStateRepository implements PromptStateRepository {
  constructor(private readonly db: DbType) {}

  async find(
    subject: PromptSubject,
    promptId: string,
  ): Promise<PromptStateData | null> {
    if (subject.scope === "guild") {
      const [row] = await this.db
        .select()
        .from(guildTable)
        .where(
          and(
            eq(guildTable.guildId, subject.id),
            eq(guildTable.promptId, promptId),
          ),
        )
        .limit(1);
      return row ?? null;
    }

    const [row] = await this.db
      .select()
      .from(userTable)
      .where(
        and(eq(userTable.userId, subject.id), eq(userTable.promptId, promptId)),
      )
      .limit(1);
    return row ?? null;
  }

  async claim(
    subject: PromptSubject,
    promptId: string,
    cooldownThreshold: Date | null,
  ): Promise<{ previous: Date | null } | false> {
    const now = new Date();
    const previous =
      (await this.find(subject, promptId))?.lastPromptedAt ?? null;

    if (subject.scope === "guild") {
      const setWhere = cooldownThreshold
        ? sql`${guildTable.lastPromptedAt} IS NULL OR ${guildTable.lastPromptedAt} < ${cooldownThreshold}`
        : sql`${guildTable.lastPromptedAt} IS NULL`;
      const rows = await this.db
        .insert(guildTable)
        .values({ guildId: subject.id, promptId, lastPromptedAt: now })
        .onConflictDoUpdate({
          target: [guildTable.guildId, guildTable.promptId],
          set: { lastPromptedAt: now },
          setWhere,
        })
        .returning({ promptId: guildTable.promptId });
      return rows.length > 0 ? { previous } : false;
    }

    const setWhere = cooldownThreshold
      ? sql`${userTable.lastPromptedAt} IS NULL OR ${userTable.lastPromptedAt} < ${cooldownThreshold}`
      : sql`${userTable.lastPromptedAt} IS NULL`;
    const rows = await this.db
      .insert(userTable)
      .values({ userId: subject.id, promptId, lastPromptedAt: now })
      .onConflictDoUpdate({
        target: [userTable.userId, userTable.promptId],
        set: { lastPromptedAt: now },
        setWhere,
      })
      .returning({ promptId: userTable.promptId });
    return rows.length > 0 ? { previous } : false;
  }

  async release(
    subject: PromptSubject,
    promptId: string,
    previous: Date | null,
  ): Promise<void> {
    await this.upsert(subject, promptId, { lastPromptedAt: previous });
  }

  async lastShownToUser(userId: bigint): Promise<Date | null> {
    const [row] = await this.db
      .select({ last: max(userTable.lastPromptedAt) })
      .from(userTable)
      .where(eq(userTable.userId, userId));
    return row?.last ?? null;
  }

  async recordShownToUser(
    userId: bigint,
    promptId: string,
    at: Date,
  ): Promise<void> {
    await this.upsert({ scope: "user", id: userId }, promptId, {
      lastPromptedAt: at,
    });
  }

  async recordSnoozed(
    subject: PromptSubject,
    promptId: string,
    snoozeUntil: Date,
  ): Promise<void> {
    await this.upsert(subject, promptId, { snoozeUntil });
  }

  async recordDismissed(
    subject: PromptSubject,
    promptId: string,
  ): Promise<void> {
    await this.upsert(subject, promptId, { dismissedAt: new Date() });
  }

  async recordCompleted(
    subject: PromptSubject,
    promptId: string,
  ): Promise<void> {
    await this.upsert(subject, promptId, { completedAt: new Date() });
  }

  private async upsert(
    subject: PromptSubject,
    promptId: string,
    fields: StateFields,
  ): Promise<void> {
    if (subject.scope === "guild") {
      await this.db
        .insert(guildTable)
        .values({ guildId: subject.id, promptId, ...fields })
        .onConflictDoUpdate({
          target: [guildTable.guildId, guildTable.promptId],
          set: fields,
        });
      return;
    }

    await this.db
      .insert(userTable)
      .values({ userId: subject.id, promptId, ...fields })
      .onConflictDoUpdate({
        target: [userTable.userId, userTable.promptId],
        set: fields,
      });
  }
}
