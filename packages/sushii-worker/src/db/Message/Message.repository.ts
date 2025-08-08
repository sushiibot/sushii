import type { DeleteResult, Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/dbTypes";

export function deleteMessagesBefore(
  db: Kysely<DB>,
  before: Date,
): Promise<DeleteResult> {
  return db
    .deleteFrom("app_public.messages")
    .where("created", "<", before)
    .executeTakeFirst();
}
