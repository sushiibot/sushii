import { and, eq, gt, ilike, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";

import type { Reminder, ReminderData } from "../domain/entities/Reminder";
import { Reminder as ReminderEntity } from "../domain/entities/Reminder";
import type { ReminderRepository } from "../domain/repositories/ReminderRepository";

type DbType = NodePgDatabase<typeof schema>;

export class DrizzleReminderRepository implements ReminderRepository {
  constructor(
    private readonly db: DbType,
    private readonly logger: Logger,
  ) {}

  async save(reminder: Reminder): Promise<void> {
    const reminderData = reminder.toData();

    await this.db
      .insert(schema.remindersInAppPublic)
      .values({
        userId: BigInt(reminderData.userId),
        id: BigInt(reminderData.id),
        description: reminderData.description,
        setAt: reminderData.setAt.toISOString(),
        expireAt: reminderData.expireAt.toISOString(),
      })
      .onConflictDoUpdate({
        target: [
          schema.remindersInAppPublic.userId,
          schema.remindersInAppPublic.id,
        ],
        set: {
          description: reminderData.description,
          expireAt: reminderData.expireAt.toISOString(),
        },
      });

    this.logger.debug(
      { userId: reminderData.userId, reminderId: reminderData.id },
      "Reminder saved to database",
    );
  }

  async findByUserIdAndId(userId: string, id: string): Promise<Reminder | null> {
    const result = await this.db
      .select()
      .from(schema.remindersInAppPublic)
      .where(
        and(
          eq(schema.remindersInAppPublic.userId, BigInt(userId)),
          eq(schema.remindersInAppPublic.id, BigInt(id)),
        ),
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToReminder(result[0]);
  }

  async findByUserId(userId: string): Promise<Reminder[]> {
    const result = await this.db
      .select()
      .from(schema.remindersInAppPublic)
      .where(eq(schema.remindersInAppPublic.userId, BigInt(userId)))
      .orderBy(schema.remindersInAppPublic.expireAt);

    return result.map(row => this.mapToReminder(row));
  }

  async findExpired(): Promise<Reminder[]> {
    const now = new Date().toISOString();
    
    const result = await this.db
      .select()
      .from(schema.remindersInAppPublic)
      .where(lte(schema.remindersInAppPublic.expireAt, now));

    return result.map(row => this.mapToReminder(row));
  }

  async deleteByUserIdAndId(userId: string, id: string): Promise<Reminder | null> {
    const result = await this.db
      .delete(schema.remindersInAppPublic)
      .where(
        and(
          eq(schema.remindersInAppPublic.userId, BigInt(userId)),
          eq(schema.remindersInAppPublic.id, BigInt(id)),
        ),
      )
      .returning();

    if (result.length === 0) {
      return null;
    }

    return this.mapToReminder(result[0]);
  }

  async deleteExpired(): Promise<Reminder[]> {
    const now = new Date().toISOString();
    
    const result = await this.db
      .delete(schema.remindersInAppPublic)
      .where(lte(schema.remindersInAppPublic.expireAt, now))
      .returning();

    return result.map(row => this.mapToReminder(row));
  }

  async countPending(): Promise<number> {
    const now = new Date().toISOString();
    
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.remindersInAppPublic)
      .where(gt(schema.remindersInAppPublic.expireAt, now));

    return result[0]?.count ?? 0;
  }

  async findForAutocomplete(userId: string, query: string): Promise<Reminder[]> {
    const result = await this.db
      .select()
      .from(schema.remindersInAppPublic)
      .where(
        and(
          eq(schema.remindersInAppPublic.userId, BigInt(userId)),
          ilike(schema.remindersInAppPublic.description, `${query}%`),
        ),
      )
      .orderBy(schema.remindersInAppPublic.expireAt)
      .limit(25);

    return result.map(row => this.mapToReminder(row));
  }

  private mapToReminder(row: typeof schema.remindersInAppPublic.$inferSelect): Reminder {
    const reminderData: ReminderData = {
      id: row.id.toString(),
      userId: row.userId.toString(),
      description: row.description,
      setAt: new Date(row.setAt),
      expireAt: new Date(row.expireAt),
    };

    return ReminderEntity.createFromDatabase(reminderData);
  }
}