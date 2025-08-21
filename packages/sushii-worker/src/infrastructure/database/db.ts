import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import logger from "@/shared/infrastructure/logger";

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

  // For new drizzle ORM to replace Kysely
  const db = drizzle({ client: pool, schema });

  dbLogger.info("pg connected");

  return db;
}
