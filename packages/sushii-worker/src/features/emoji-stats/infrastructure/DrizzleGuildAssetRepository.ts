import { eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { guildEmojisAndStickersInAppPublic } from "@/infrastructure/database/schema";

import { GuildAsset } from "../domain/entities";
import type { GuildAssetRepository } from "../domain/repositories";

export class DrizzleGuildAssetRepository implements GuildAssetRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  async findByIds(assetIds: string[]): Promise<GuildAsset[]> {
    if (assetIds.length === 0) {
      return [];
    }

    const results = await this.db
      .select()
      .from(guildEmojisAndStickersInAppPublic)
      .where(
        inArray(
          guildEmojisAndStickersInAppPublic.id,
          assetIds.map((id) => BigInt(id)),
        ),
      );

    return results.map(
      (row) =>
        new GuildAsset(
          row.id.toString(),
          row.guildId.toString(),
          row.name,
          row.type,
        ),
    );
  }

  async upsert(asset: Omit<GuildAsset, "id"> & { id: string }): Promise<void> {
    await this.db
      .insert(guildEmojisAndStickersInAppPublic)
      .values({
        id: BigInt(asset.id),
        guildId: BigInt(asset.guildId),
        name: asset.name,
        type: asset.type,
      })
      .onConflictDoUpdate({
        target: guildEmojisAndStickersInAppPublic.id,
        set: {
          name: asset.name,
        },
      });
  }

  async upsertMany(
    assets: (Omit<GuildAsset, "id"> & { id: string })[],
  ): Promise<void> {
    if (assets.length === 0) {
      return;
    }

    const values = assets.map((asset) => ({
      id: BigInt(asset.id),
      guildId: BigInt(asset.guildId),
      name: asset.name,
      type: asset.type,
    }));

    await this.db
      .insert(guildEmojisAndStickersInAppPublic)
      .values(values)
      .onConflictDoUpdate({
        target: guildEmojisAndStickersInAppPublic.id,
        set: {
          name: sql`excluded.name`,
        },
      });
  }
}
