import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { permissionUsageCoverageInAppPublic } from "@/infrastructure/database/schema";

import type {
  PermissionUsageCoverage,
  PermissionUsageCoverageRepository,
} from "../domain/PermissionUsageCoverageRepository";

const table = permissionUsageCoverageInAppPublic;

export class DrizzlePermissionUsageCoverageRepository
  implements PermissionUsageCoverageRepository
{
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async get(guildId: string): Promise<PermissionUsageCoverage | null> {
    const [row] = await this.db
      .select()
      .from(table)
      .where(eq(table.guildId, BigInt(guildId)));

    if (!row) {
      return null;
    }

    return {
      trackingStartedAt: row.trackingStartedAt,
      backfilledAt: row.backfilledAt,
      backfillCoverage: Object.fromEntries(
        Object.entries(row.backfillCoverage ?? {}).map(([action, iso]) => [
          action,
          new Date(iso),
        ]),
      ),
    };
  }

  async claimBackfill(
    guildId: string,
    staleClaimBefore: Date,
  ): Promise<Date | null> {
    const id = BigInt(guildId);
    const now = new Date();

    // Live tracking may already have created the row, so the claim is an update.
    await this.db
      .insert(table)
      .values({ guildId: id, trackingStartedAt: now })
      .onConflictDoNothing();

    const [claimed] = await this.db
      .update(table)
      .set({ backfillClaimedAt: now })
      .where(
        and(
          eq(table.guildId, id),
          isNull(table.backfilledAt),
          or(
            isNull(table.backfillClaimedAt),
            lt(table.backfillClaimedAt, staleClaimBefore),
          ),
        ),
      )
      .returning({ trackingStartedAt: table.trackingStartedAt });

    return claimed?.trackingStartedAt ?? null;
  }

  async completeBackfill(
    guildId: string,
    coverage: Record<string, Date>,
  ): Promise<void> {
    await this.db
      .update(table)
      .set({
        backfilledAt: new Date(),
        backfillClaimedAt: null,
        backfillCoverage: Object.fromEntries(
          Object.entries(coverage).map(([action, date]) => [
            action,
            date.toISOString(),
          ]),
        ),
      })
      .where(eq(table.guildId, BigInt(guildId)));
  }

  async releaseBackfillClaim(guildId: string): Promise<void> {
    await this.db
      .update(table)
      .set({ backfillClaimedAt: null })
      .where(eq(table.guildId, BigInt(guildId)));
  }
}
