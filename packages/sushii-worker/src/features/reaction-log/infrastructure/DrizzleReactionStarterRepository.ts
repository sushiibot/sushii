import { and, eq, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import { reactionStartersInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type { ReactionStarterRepository } from "../domain/repositories/ReactionStarterRepository";

export class DrizzleReactionStarterRepository implements ReactionStarterRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async saveStarter(messageId: string, emoji: string, userId: string, guildId: string): Promise<void> {
    this.logger.trace(
      { messageId, emoji, userId, guildId },
      "Saving reaction starter"
    );

    await this.db
      .insert(reactionStartersInAppPublic)
      .values({
        messageId: BigInt(messageId),
        emoji,
        userId: BigInt(userId),
        guildId: BigInt(guildId),
      })
      .onConflictDoNothing(); // If already exists, that's fine
  }

  async getStarter(messageId: string, emoji: string): Promise<string | null> {
    this.logger.trace({ messageId, emoji }, "Getting reaction starter");

    const result = await this.db
      .select({ userId: reactionStartersInAppPublic.userId })
      .from(reactionStartersInAppPublic)
      .where(
        and(
          eq(reactionStartersInAppPublic.messageId, BigInt(messageId)),
          eq(reactionStartersInAppPublic.emoji, emoji)
        )
      )
      .limit(1);

    return result[0]?.userId.toString() ?? null;
  }

  async deleteOldStarters(beforeDate: Date): Promise<number> {
    this.logger.debug({ beforeDate }, "Deleting old reaction starters");

    const result = await this.db
      .delete(reactionStartersInAppPublic)
      .where(lt(reactionStartersInAppPublic.createdAt, beforeDate));

    const deleted = result.rowCount ?? 0;
    this.logger.debug({ deleted, beforeDate }, "Deleted old reaction starters");
    
    return deleted;
  }
}