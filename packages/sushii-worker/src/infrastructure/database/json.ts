import type { RawBuilder } from "kysely";
import { sql } from "kysely";

export function json<T>(object: T): RawBuilder<string> {
  return sql`cast (${JSON.stringify(object)} as jsonb)`;
}
