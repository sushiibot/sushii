import { and, eq } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";

import { msgLogBlocksInAppPublic } from "@/infrastructure/database/schema";
import * as schema from "@/infrastructure/database/schema";

import { MessageLogBlock } from "../domain/entities/MessageLogBlock";
import { MessageLogBlockRepository } from "../domain/repositories/MessageLogBlockRepository";

export class DrizzleMessageLogBlockRepository
  implements MessageLogBlockRepository
{
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async findByGuildId(guildId: string): Promise<MessageLogBlock[]> {
    this.logger.debug({ guildId }, "Finding message log blocks");

    const results = await this.db
      .select()
      .from(msgLogBlocksInAppPublic)
      .where(eq(msgLogBlocksInAppPublic.guildId, BigInt(guildId)));

    return results.map(
      (row) =>
        new MessageLogBlock(row.guildId.toString(), row.channelId.toString()),
    );
  }

  async addBlock(guildId: string, channelId: string): Promise<void> {
    this.logger.debug({ guildId, channelId }, "Adding message log block");

    await this.db
      .insert(msgLogBlocksInAppPublic)
      .values({
        guildId: BigInt(guildId),
        channelId: BigInt(channelId),
      })
      .onConflictDoNothing({
        target: [
          msgLogBlocksInAppPublic.guildId,
          msgLogBlocksInAppPublic.channelId,
        ],
      });
  }

  async removeBlock(guildId: string, channelId: string): Promise<void> {
    this.logger.debug({ guildId, channelId }, "Removing message log block");

    await this.db
      .delete(msgLogBlocksInAppPublic)
      .where(
        and(
          eq(msgLogBlocksInAppPublic.guildId, BigInt(guildId)),
          eq(msgLogBlocksInAppPublic.channelId, BigInt(channelId)),
        ),
      );
  }
}
