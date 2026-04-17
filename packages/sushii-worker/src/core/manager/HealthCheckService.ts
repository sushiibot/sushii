import type { ClusterManager } from "discord-hybrid-sharding";
import { sql } from "drizzle-orm";

import { initDatabase } from "@/infrastructure/database/db";
import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("HealthCheckService");

const SHARD_CACHE_TTL_MS = 10_000;
const DB_CHECK_CACHE_TTL_MS = 5_000;
const DB_CHECK_TIMEOUT_MS = 3_000;
const UPTIME_READY_THRESHOLD_S = 300;

export const ShardStatusToName: Record<number, string> = {
  0: "Ready",
  1: "Connecting",
  2: "Reconnecting",
  3: "Idle",
  4: "Nearly",
  5: "Disconnected",
  6: "WaitingForGuilds",
  7: "Identifying",
  8: "Resuming",
};

export interface ShardInfo {
  id: number;
  status: number;
  status_name: string;
  ping_ms: number;
}

export interface MemoryInfo {
  heap_used_mb: number;
  rss_mb: number;
}

type CheckResult = "pass" | "fail";

interface ShardCache {
  data: ShardInfo[];
  fetchedAt: number;
}

export class HealthCheckService {
  private readonly startedAt: number;
  private shardCache: ShardCache | null = null;
  private dbCache: { result: CheckResult; fetchedAt: number } | null = null;

  constructor(
    private readonly manager: ClusterManager,
    private readonly db: ReturnType<typeof initDatabase>,
  ) {
    this.startedAt = Date.now();
  }

  async checkDatabase(): Promise<CheckResult> {
    if (this.dbCache && Date.now() - this.dbCache.fetchedAt < DB_CHECK_CACHE_TTL_MS) {
      return this.dbCache.result;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.db.execute(sql`SELECT 1`),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Database health check timed out")),
            DB_CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      this.dbCache = { result: "pass", fetchedAt: Date.now() };
      return "pass";
    } catch (err) {
      logger.warn({ err }, "Database health check failed");
      this.dbCache = { result: "fail", fetchedAt: Date.now() };
      return "fail";
    } finally {
      clearTimeout(timer);
    }
  }

  async getShardData(): Promise<ShardInfo[] | null> {
    if (
      this.shardCache &&
      Date.now() - this.shardCache.fetchedAt < SHARD_CACHE_TTL_MS
    ) {
      return this.shardCache.data;
    }

    try {
      const results = await this.manager.broadcastEval(
        (client) =>
          client.ws.shards.map((s) => ({
            id: s.id,
            status: s.status,
            ping: s.ping,
          })),
        { timeout: 5000 },
      );

      const data: ShardInfo[] = results.flat().map((s) => ({
        id: s.id,
        status: s.status,
        status_name: ShardStatusToName[s.status] ?? "Unknown",
        ping_ms: s.ping,
      }));

      this.shardCache = { data, fetchedAt: Date.now() };
      return data;
    } catch (err) {
      logger.warn({ err }, "Failed to collect shard data via broadcastEval");
      this.shardCache = null;
      return null;
    }
  }

  getMemory(): MemoryInfo {
    const mem = process.memoryUsage();
    return {
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      rss_mb: Math.round(mem.rss / 1024 / 1024),
    };
  }

  getUptimeSeconds(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  isUptimeReady(): boolean {
    return this.getUptimeSeconds() >= UPTIME_READY_THRESHOLD_S;
  }
}
