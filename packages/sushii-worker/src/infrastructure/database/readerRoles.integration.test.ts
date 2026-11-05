import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

// sushii-logs-viewer and sushii-mcp log in as members of these roles. A migration that recreates one of these
// tables drops its grant, and those services then fail in production only.
const READER_TABLES: Record<string, string[]> = {
  sushii_logs_reader: ["messages", "cached_guilds", "cached_users"],
  sushii_mcp_reader: [
    "mod_logs",
    "cached_guilds",
    "guild_bans",
    "guild_configs",
  ],
};

describe("reader roles", () => {
  const testDb = new PostgresTestDatabase();
  let db: Awaited<ReturnType<PostgresTestDatabase["initialize"]>>;

  beforeAll(async () => {
    db = await testDb.initialize();
  });

  afterAll(async () => {
    await testDb.close();
  });

  for (const [role, tables] of Object.entries(READER_TABLES)) {
    test(`${role} can read its tables`, async () => {
      for (const table of tables) {
        const result = await db.execute(
          sql`SELECT has_table_privilege(${role}, ${`app_public.${table}`}, 'SELECT') AS ok`,
        );
        expect({ table, ok: result.rows[0]?.ok }).toEqual({ table, ok: true });
      }
    });
  }

  // With row-level security on and no policy for them, readers get zero rows and no error.
  test("no app_public table has row-level security", async () => {
    const result = await db.execute(
      sql`SELECT relname FROM pg_class WHERE relnamespace = 'app_public'::regnamespace AND relrowsecurity`,
    );
    expect(result.rows).toEqual([]);
  });
});
