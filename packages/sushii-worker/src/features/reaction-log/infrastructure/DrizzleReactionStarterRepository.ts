import { and, eq, inArray, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import { reactionStartersInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import { ReactionStarter } from "../domain/entities/ReactionStarter";
import type { ReactionStarterRepository } from "../domain/repositories/ReactionStarterRepository";

export class DrizzleReactionStarterRepository
  implements ReactionStarterRepository
{
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async saveStarter(
    messageId: string,
    emojiId: string,
    emojiName: string | null,
    userId: string,
    guildId: string,
  ): Promise<void> {
    this.logger.trace(
      { messageId, emojiId, emojiName, userId, guildId },
      "Saving reaction starter",
    );

    try {
      await this.db
        .insert(reactionStartersInAppPublic)
        .values({
          messageId: BigInt(messageId),
          emojiId,
          emojiName,
          userId: BigInt(userId),
          guildId: BigInt(guildId),
        })
        .onConflictDoNothing(); // If already exists, that's fine
    } catch (err) {
      this.logger.error(
        { err, messageId, emojiId, emojiName, userId, guildId },
        "Failed to save reaction starter",
      );
      throw new Error("Database error while saving reaction starter", {
        cause: err,
      });
    }
  }

  async hasAnyStarter(messageId: string, emojiId: string): Promise<boolean> {
    this.logger.trace({ messageId, emojiId }, "Checking if any starter exists");

    try {
      const result = await this.db
        .select({ userId: reactionStartersInAppPublic.userId })
        .from(reactionStartersInAppPublic)
        .where(
          and(
            eq(reactionStartersInAppPublic.messageId, BigInt(messageId)),
            eq(reactionStartersInAppPublic.emojiId, emojiId),
          ),
        )
        .limit(1);

      return result.length > 0;
    } catch (err) {
      this.logger.error(
        { err, messageId, emojiId },
        "Failed to check if starter exists",
      );
      throw new Error("Database error while checking starter existence", {
        cause: err,
      });
    }
  }

  async getStarters(messageId: string, emojiId: string): Promise<string[]> {
    this.logger.trace({ messageId, emojiId }, "Getting all reaction starters");

    try {
      const result = await this.db
        .select({ userId: reactionStartersInAppPublic.userId })
        .from(reactionStartersInAppPublic)
        .where(
          and(
            eq(reactionStartersInAppPublic.messageId, BigInt(messageId)),
            eq(reactionStartersInAppPublic.emojiId, emojiId),
          ),
        )
        .orderBy(reactionStartersInAppPublic.createdAt);

      return result.map((row) => row.userId.toString());
    } catch (err) {
      this.logger.error(
        { err, messageId, emojiId },
        "Failed to get reaction starters",
      );
      throw new Error("Database error while getting reaction starters", {
        cause: err,
      });
    }
  }

  async getBatchAllStarters(
    messageId: string,
    emojiIds: string[],
  ): Promise<Map<string, string[]>> {
    this.logger.trace(
      { messageId, emojiIds },
      "Getting batch reaction starters",
    );

    if (emojiIds.length === 0) {
      return new Map();
    }

    try {
      const result = await this.db
        .select({
          emojiId: reactionStartersInAppPublic.emojiId,
          userId: reactionStartersInAppPublic.userId,
        })
        .from(reactionStartersInAppPublic)
        .where(
          and(
            eq(reactionStartersInAppPublic.messageId, BigInt(messageId)),
            inArray(reactionStartersInAppPublic.emojiId, emojiIds),
          ),
        )
        .orderBy(
          reactionStartersInAppPublic.emojiId,
          reactionStartersInAppPublic.createdAt,
        );

      const startersMap = new Map<string, string[]>();
      for (const row of result) {
        const emojiId = row.emojiId;
        const userId = row.userId.toString();
        const existingArray = startersMap.get(emojiId);
        if (existingArray) {
          existingArray.push(userId);
        } else {
          startersMap.set(emojiId, [userId]);
        }
      }

      this.logger.trace(
        {
          messageId,
          requestedEmojiIds: emojiIds.length,
          foundEmojiIds: startersMap.size,
        },
        "Retrieved batch reaction starters",
      );

      return startersMap;
    } catch (err) {
      this.logger.error(
        { err, messageId, emojiIds },
        "Failed to get batch reaction starters",
      );
      throw new Error("Database error while getting batch reaction starters", {
        cause: err,
      });
    }
  }

  async getAllStartersForMessage(
    messageId: string,
  ): Promise<Map<string, ReactionStarter>> {
    this.logger.trace(
      { messageId },
      "Getting all reaction starters for message",
    );

    try {
      const result = await this.db
        .select({
          emojiId: reactionStartersInAppPublic.emojiId,
          emojiName: reactionStartersInAppPublic.emojiName,
          userId: reactionStartersInAppPublic.userId,
          guildId: reactionStartersInAppPublic.guildId,
          createdAt: reactionStartersInAppPublic.createdAt,
        })
        .from(reactionStartersInAppPublic)
        .where(eq(reactionStartersInAppPublic.messageId, BigInt(messageId)))
        .orderBy(
          reactionStartersInAppPublic.emojiId,
          reactionStartersInAppPublic.createdAt,
        );

      const startersMap = new Map<string, ReactionStarter>();
      for (const row of result) {
        const emojiId = row.emojiId;
        const userId = row.userId.toString();
        const guildId = row.guildId.toString();

        const existing = startersMap.get(emojiId);
        if (existing) {
          // Add this user to existing starter
          startersMap.set(emojiId, existing.withAdditionalStarter(userId));
        } else {
          // Create new ReactionStarter
          const starter = new ReactionStarter(
            messageId,
            emojiId,
            row.emojiName,
            [userId],
            guildId,
            row.createdAt,
          );
          startersMap.set(emojiId, starter);
        }
      }

      this.logger.trace(
        {
          messageId,
          foundEmojiIds: startersMap.size,
          totalStarters: result.length,
        },
        "Retrieved all reaction starters for message",
      );

      return startersMap;
    } catch (err) {
      this.logger.error(
        { err, messageId },
        "Failed to get all reaction starters for message",
      );

      throw new Error(
        "Database error while getting all message reaction starters",
        {
          cause: err,
        },
      );
    }
  }

  async deleteOldStarters(beforeDate: Date): Promise<number> {
    this.logger.trace({ beforeDate }, "Deleting old reaction starters");

    try {
      const result = await this.db
        .delete(reactionStartersInAppPublic)
        .where(lt(reactionStartersInAppPublic.createdAt, beforeDate));

      const deleted = result.rowCount ?? 0;
      this.logger.trace(
        { deleted, beforeDate },
        "Deleted old reaction starters",
      );

      return deleted;
    } catch (err) {
      this.logger.error(
        { err, beforeDate },
        "Failed to delete old reaction starters",
      );
      throw new Error("Database error while deleting old reaction starters", {
        cause: err,
      });
    }
  }
}
