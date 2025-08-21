import { describe, expect, it } from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";

import { DrizzleStatusRepository } from "./DrizzleStatusRepository";

describe("DrizzleStatusRepository", () => {
  it("should return a bigint for database latency", async () => {
    // Mock database that returns immediately
    const mockDb = {
      execute: async () => Promise.resolve([{ "?column?": 2 }]),
    } as unknown as NodePgDatabase<typeof schema>;

    const repository = new DrizzleStatusRepository(mockDb);
    const latency = await repository.checkDatabaseLatency();

    expect(typeof latency).toBe("bigint");
    expect(latency).toBeGreaterThan(0n);
  });
});
