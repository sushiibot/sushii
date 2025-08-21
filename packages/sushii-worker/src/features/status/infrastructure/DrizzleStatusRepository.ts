import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";

export class DrizzleStatusRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async checkDatabaseLatency(): Promise<bigint> {
    const start = process.hrtime.bigint();
    await this.db.execute(sql`select 1 + 1`);
    const end = process.hrtime.bigint();

    return end - start;
  }
}
