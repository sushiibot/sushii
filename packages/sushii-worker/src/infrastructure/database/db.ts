import { Pool } from "pg";
// or `import * as Cursor from 'pg-cursor'` depending on your tsconfig
import Cursor from "pg-cursor";
import { Kysely, PostgresDialect } from "kysely";
import { drizzle } from "drizzle-orm/node-postgres";
import logger from "@/shared/infrastructure/logger";
import type { DB } from "./dbTypes";
import { config } from "@/shared/infrastructure/config";
import * as schema from "./schema";

const dbLogger = logger.child({ module: "db" });

export function initDatabase(url: string, maxConnections: number) {
  const pool = new Pool({
    connectionString: url,
    // PER shard cluster, as each cluster has its own process (hybrid-sharding)
    max: maxConnections,
  });

  pool.on("error", (err) => {
    dbLogger.error(err, "pg pool error");
  });

  const db = new Kysely<DB>({
    // PostgresDialect requires the Cursor dependency
    dialect: new PostgresDialect({
      pool,
      cursor: Cursor,
    }),
  });

  // For new drizzle ORM to replace Kysely
  const drizzleDb = drizzle({ client: pool, schema });

  dbLogger.info("pg connected");

  return { db, drizzleDb };
}

// Initialize globally for backwards compatibility
const { db: globalDb, drizzleDb } = initDatabase(config.database.url, 3);

export { drizzleDb };
export default globalDb;
