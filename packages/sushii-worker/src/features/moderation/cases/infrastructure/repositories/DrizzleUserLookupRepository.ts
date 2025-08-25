import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import {
  cachedGuildsInAppPublic,
  guildBansInAppPublic,
  guildConfigsInAppPublic,
  modLogsInAppPublic,
} from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type { UserLookupBan } from "../../domain/entities/UserLookupBan";
import type { UserLookupRepository } from "../../domain/repositories/UserLookupRepository";

/**
 * Drizzle ORM implementation of the UserLookupRepository.
 * Handles database operations for cross-server ban lookups.
 */
export class DrizzleUserLookupRepository implements UserLookupRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async getUserCrossServerBans(
    userId: string,
  ): Promise<Result<UserLookupBan[], string>> {
    try {
      const bans = await this.db
        .selectDistinctOn(
          // Ensure only 1 per guild
          [guildBansInAppPublic.guildId],
          {
            guildId: guildBansInAppPublic.guildId,
            reason: modLogsInAppPublic.reason,
            actionTime: modLogsInAppPublic.actionTime,
            lookupDetailsOptIn: guildConfigsInAppPublic.lookupDetailsOptIn,
            // Cached guild data
            guildName: cachedGuildsInAppPublic.name,
            memberCount: cachedGuildsInAppPublic.memberCount,
            guildFeatures: cachedGuildsInAppPublic.features,
          },
        )
        .from(guildBansInAppPublic)
        .leftJoin(
          modLogsInAppPublic,
          and(
            eq(guildBansInAppPublic.guildId, modLogsInAppPublic.guildId),
            eq(guildBansInAppPublic.userId, modLogsInAppPublic.userId),
            eq(modLogsInAppPublic.action, "ban"),
          ),
        )
        .leftJoin(
          guildConfigsInAppPublic,
          eq(guildConfigsInAppPublic.id, guildBansInAppPublic.guildId),
        )
        .leftJoin(
          cachedGuildsInAppPublic,
          eq(cachedGuildsInAppPublic.id, guildBansInAppPublic.guildId),
        )
        .where(
          and(
            eq(guildBansInAppPublic.userId, BigInt(userId)),
            // TODO: Pending bans are inconsistent, still pending when shouldn't be
            // Filter by non-pending ONLY if this is resolved
            // or(
            //   eq(modLogsInAppPublic.pending, false),
            //   // Allow missing mod cases for the bans
            //   isNull(modLogsInAppPublic.pending),
            // ),
          ),
        )
        // Only get the latest row with the distinct on
        // Need to sort by guild ID first to de-duplicate with the DISTINCT
        // Actual order is by memberCount, which is handled by service layer.
        .orderBy(desc(guildBansInAppPublic.guildId));

      const userLookupBans: UserLookupBan[] = bans.map((ban) => ({
        guildId: ban.guildId.toString(),
        reason: ban.reason,
        actionTime: ban.actionTime,
        lookupDetailsOptIn: ban.lookupDetailsOptIn ?? false,
        guildName: ban.guildName,
        guildMembers: ban.memberCount ? Number(ban.memberCount) : 0,
        guildFeatures: ban.guildFeatures ?? [],
      }));

      this.logger.debug(
        { userId, banCount: userLookupBans.length },
        "Fetched user cross-server bans",
      );

      return Ok(userLookupBans);
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        "Failed to fetch user cross-server bans",
      );

      return Err(`Cross-server ban fetch failed`);
    }
  }
}
