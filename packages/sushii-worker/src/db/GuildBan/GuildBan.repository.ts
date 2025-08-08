import type { DeleteResult, Kysely } from "kysely";
import opentelemetry from "@opentelemetry/api";
import type { DB } from "../../infrastructure/database/dbTypes";

const tracer = opentelemetry.trace.getTracer("event-handler");

export function clearGuildBans(
  db: Kysely<DB>,
  guildId: string,
): Promise<DeleteResult> {
  const span = tracer.startSpan("clearGuildBans");

  try {
    return db
      .deleteFrom("app_public.guild_bans")
      .where("guild_id", "=", guildId)
      .executeTakeFirst();
  } finally {
    span.end();
  }
}

export async function insertGuildBans(
  db: Kysely<DB>,
  guildId: string,
  userIds: string[],
): Promise<void> {
  const span = tracer.startSpan("insertGuildBans");

  try {
    await db
      .insertInto("app_public.guild_bans")
      .values(
        userIds.map((userId) => ({
          guild_id: guildId,
          user_id: userId,
        })),
      )
      // Ignore conflicts, there shouldn't be any cuz we just cleared them but
      // who knows
      .onConflict((oc) => oc.doNothing())
      .execute();
  } finally {
    span.end();
  }
}
