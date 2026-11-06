/**
 * Serves a data removal request: `bun scripts/delete-user-analytics.ts <discord-user-id>`.
 * Feedback posts in the staff channel have to be removed by hand.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import pino from "pino";

import { ProductAnalyticsService } from "@/features/product-analytics/application/ProductAnalyticsService";
import { DrizzleProductAnalyticsRepository } from "@/features/product-analytics/infrastructure/DrizzleProductAnalyticsRepository";
import * as schema from "@/infrastructure/database/schema";
import { readSecret } from "@/shared/infrastructure/config/secrets";

const userId = process.argv[2];
if (!userId || !/^\d{17,20}$/.test(userId)) {
  console.error(
    "Usage: bun scripts/delete-user-analytics.ts <discord-user-id>",
  );
  process.exit(1);
}

const key = readSecret("PRODUCT_ANALYTICS_KEY");
if (!key) {
  console.error(
    "PRODUCT_ANALYTICS_KEY is not set, so usage records can't be found",
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: readSecret("DATABASE_URL") });
const service = new ProductAnalyticsService(
  new DrizzleProductAnalyticsRepository(drizzle(pool, { schema })),
  key,
  pino(),
);

console.log(await service.deleteUserData(userId));
await pool.end();
