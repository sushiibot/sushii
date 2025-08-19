import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import {
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
        .where(
          and(
            eq(guildBansInAppPublic.userId, BigInt(userId)),
            // Exclude pending bans
            eq(modLogsInAppPublic.pending, false),
          ),
        )
        // Only get the latest row with the distinct on
        .orderBy(desc(modLogsInAppPublic.actionTime));

      const userLookupBans: UserLookupBan[] = bans.map((ban) => ({
        guildId: ban.guildId.toString(),
        guildName: null, // Will be filled in by the service layer
        reason: ban.reason,
        actionTime: ban.actionTime,
        lookupDetailsOptIn: ban.lookupDetailsOptIn ?? false,
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
      return Err("Cross-server ban fetch failed");
    }
  }
}
