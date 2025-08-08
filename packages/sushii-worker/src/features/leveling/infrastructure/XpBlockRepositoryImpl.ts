import { and, eq, inArray, or } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/infrastructure/database/schema";
import { xpBlocksInAppPublic } from "@/infrastructure/database/schema";

import { XpBlock } from "../domain/entities/XpBlock";
import { XpBlockRepository } from "../domain/repositories/XpBlockRepository";

export class XpBlockRepositoryImpl implements XpBlockRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findActiveBlocks(
    guildId: string,
    channelId: string,
    roleIds: string[],
  ): Promise<XpBlock[]> {
    const guildIdBigint = BigInt(guildId);
    const channelIdBigint = BigInt(channelId);
    const roleIdsBigint = roleIds.map((id) => BigInt(id));

    const conditions = [
      and(
        eq(xpBlocksInAppPublic.blockId, channelIdBigint),
        eq(xpBlocksInAppPublic.blockType, "channel"),
      ),
    ];

    if (roleIdsBigint.length > 0) {
      conditions.push(
        and(
          inArray(xpBlocksInAppPublic.blockId, roleIdsBigint),
          eq(xpBlocksInAppPublic.blockType, "role"),
        ),
      );
    }

    const result = await this.db
      .select()
      .from(xpBlocksInAppPublic)
      .where(
        and(eq(xpBlocksInAppPublic.guildId, guildIdBigint), or(...conditions)),
      );

    return result.map(
      (record) =>
        new XpBlock(
          guildId,
          record.blockId.toString(),
          record.blockType as "channel" | "role",
        ),
    );
  }

  async findByGuildId(guildId: string): Promise<XpBlock[]> {
    const guildIdBigint = BigInt(guildId);

    const result = await this.db
      .select()
      .from(xpBlocksInAppPublic)
      .where(eq(xpBlocksInAppPublic.guildId, guildIdBigint));

    return result.map(
      (record) =>
        new XpBlock(
          guildId,
          record.blockId.toString(),
          record.blockType as "channel" | "role",
        ),
    );
  }

  async findChannelBlocksByGuildId(guildId: string): Promise<string[]> {
    const guildIdBigint = BigInt(guildId);

    const result = await this.db
      .select({ blockId: xpBlocksInAppPublic.blockId })
      .from(xpBlocksInAppPublic)
      .where(
        and(
          eq(xpBlocksInAppPublic.guildId, guildIdBigint),
          eq(xpBlocksInAppPublic.blockType, "channel"),
        ),
      );

    return result.map((record) => record.blockId.toString());
  }

  async findRoleBlocksByGuildId(guildId: string): Promise<string[]> {
    const guildIdBigint = BigInt(guildId);

    const result = await this.db
      .select({ blockId: xpBlocksInAppPublic.blockId })
      .from(xpBlocksInAppPublic)
      .where(
        and(
          eq(xpBlocksInAppPublic.guildId, guildIdBigint),
          eq(xpBlocksInAppPublic.blockType, "role"),
        ),
      );

    return result.map((record) => record.blockId.toString());
  }

  async create(xpBlock: XpBlock): Promise<XpBlock | null> {
    const guildIdBigint = BigInt(xpBlock.getGuildId());
    const blockIdBigint = BigInt(xpBlock.getBlockId());

    try {
      const result = await this.db
        .insert(xpBlocksInAppPublic)
        .values({
          guildId: guildIdBigint,
          blockId: blockIdBigint,
          blockType: xpBlock.getBlockType(),
        })
        .onConflictDoUpdate({
          target: [xpBlocksInAppPublic.guildId, xpBlocksInAppPublic.blockId],
          set: {
            blockType: xpBlock.getBlockType(),
          },
        })
        .returning();

      if (result.length === 0) {
        return null;
      }

      const record = result[0];
      return new XpBlock(
        xpBlock.getGuildId(),
        record.blockId.toString(),
        record.blockType as "channel" | "role",
      );
    } catch (error) {
      // If it's a conflict error, return null to indicate the block already exists
      if (error instanceof Error && error.message.includes("duplicate")) {
        return null;
      }
      throw error;
    }
  }

  async delete(guildId: string, blockId: string): Promise<XpBlock | null> {
    const guildIdBigint = BigInt(guildId);
    const blockIdBigint = BigInt(blockId);

    const result = await this.db
      .delete(xpBlocksInAppPublic)
      .where(
        and(
          eq(xpBlocksInAppPublic.guildId, guildIdBigint),
          eq(xpBlocksInAppPublic.blockId, blockIdBigint),
        ),
      )
      .returning();

    if (result.length === 0) {
      return null;
    }

    const record = result[0];
    return new XpBlock(
      guildId,
      record.blockId.toString(),
      record.blockType as "channel" | "role",
    );
  }
}
