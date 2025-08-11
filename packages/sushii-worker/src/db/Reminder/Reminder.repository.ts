import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { DB } from "../../infrastructure/database/dbTypes";
import type { ReminderRow } from "./Reminder.table";

export function insertReminder(
  db: Kysely<DB>,
  userId: string,
  expireAt: Date,
  description: string,
): Promise<ReminderRow> {
  return db
    .insertInto("app_public.reminders")
    .values(({ selectFrom }) => ({
      // Insert the next ID for the specific user
      id: selectFrom("app_public.reminders")
        .select((eb) =>
          eb.fn
            .coalesce(
              // Add 1 to the max ID
              eb(eb.fn.max("id"), "+", "1"),
              // Or start at 1
              sql<number>`1`,
            )
            .as("id"),
        )
        .where("user_id", "=", userId),
      user_id: userId,
      set_at: new Date(),
      expire_at: expireAt,
      description,
    }))
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function listReminders(
  db: Kysely<DB>,
  userId: string,
): Promise<ReminderRow[]> {
  return db
    .selectFrom("app_public.reminders")
    .selectAll()
    .where("user_id", "=", userId)
    .execute();
}

export function deleteReminder(
  db: Kysely<DB>,
  userId: string,
  id: string,
): Promise<ReminderRow | undefined> {
  return db
    .deleteFrom("app_public.reminders")
    .returningAll()
    .where("user_id", "=", userId)
    .where("id", "=", id)
    .executeTakeFirst();
}

export function getAllExpiredReminders(db: Kysely<DB>): Promise<ReminderRow[]> {
  return db
    .selectFrom("app_public.reminders")
    .selectAll()
    .where("expire_at", "<=", new Date())
    .execute();
}

export function getAndDeleteExpiredReminders(
  db: Kysely<DB>,
): Promise<ReminderRow[]> {
  return db
    .deleteFrom("app_public.reminders")
    .returningAll()
    .where("expire_at", "<=", new Date())
    .execute();
}

export async function countAllPendingReminders(
  db: Kysely<DB>,
): Promise<number> {
  const { count } = await db
    .selectFrom("app_public.reminders")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("expire_at", ">", new Date())
    .executeTakeFirstOrThrow();

  return Number(count);
}
