import { eq, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import {
  permissionUsageCoverageInAppPublic,
  permissionUsageInAppPublic,
} from "@/infrastructure/database/schema";

import type { PermissionUsage } from "../domain/PermissionUsage";
import type { PermissionUsageRepository } from "../domain/PermissionUsageRepository";
import { mergeUsages } from "../domain/mergeUsages";

export class DrizzlePermissionUsageRepository
  implements PermissionUsageRepository
{
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async record(usages: readonly PermissionUsage[]): Promise<void> {
    const rows = mergeUsages(usages).map((usage) => ({
      guildId: BigInt(usage.guildId),
      userId: BigInt(usage.userId),
      permission: usage.permission,
      source: usage.source,
      channelId: usage.channelId ? BigInt(usage.channelId) : null,
      firstUsedAt: usage.firstUsedAt,
      lastUsedAt: usage.lastUsedAt,
      useCount: BigInt(usage.useCount),
    }));

    if (rows.length === 0) {
      return;
    }

    const table = permissionUsageInAppPublic;

    await this.db
      .insert(table)
      .values(rows)
      .onConflictDoUpdate({
        target: [table.guildId, table.userId, table.permission, table.source],
        set: {
          firstUsedAt: sql`LEAST(${table.firstUsedAt}, excluded.first_used_at)`,
          lastUsedAt: sql`GREATEST(${table.lastUsedAt}, excluded.last_used_at)`,
          channelId: sql`CASE WHEN excluded.last_used_at >= ${table.lastUsedAt} THEN excluded.channel_id ELSE ${table.channelId} END`,
          useCount: sql`${table.useCount} + excluded.use_count`,
        },
      });
  }

  async ensureTrackingStarted(guildId: string, startedAt: Date): Promise<void> {
    await this.db
      .insert(permissionUsageCoverageInAppPublic)
      .values({ guildId: BigInt(guildId), trackingStartedAt: startedAt })
      .onConflictDoNothing();
  }

  async deleteLastUsedBefore(cutoff: Date): Promise<number> {
    const deleted = await this.db
      .delete(permissionUsageInAppPublic)
      .where(lt(permissionUsageInAppPublic.lastUsedAt, cutoff))
      .returning({ guildId: permissionUsageInAppPublic.guildId });

    return deleted.length;
  }

  async deleteGuild(guildId: string): Promise<void> {
    const id = BigInt(guildId);

    await this.db.transaction(async (tx) => {
      await tx
        .delete(permissionUsageInAppPublic)
        .where(eq(permissionUsageInAppPublic.guildId, id));
      await tx
        .delete(permissionUsageCoverageInAppPublic)
        .where(eq(permissionUsageCoverageInAppPublic.guildId, id));
    });
  }
}
