import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@sushiibot/sushii-worker/schema";

import { logger } from "./logger.ts";

export type Db = NodePgDatabase<typeof schema>;

export function initDatabase(url: string, maxConnections: number): Db {
  const pool = new Pool({
    connectionString: url,
    max: maxConnections,
  });

  pool.on("error", (err) => {
    logger.error({ err }, "pg pool error");
  });

  const db = drizzle({ client: pool, schema });

  logger.info("pg connected");

  return db;
}
