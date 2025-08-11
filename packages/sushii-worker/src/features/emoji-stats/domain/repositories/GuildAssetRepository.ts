import type { GuildAsset } from "../entities";

export interface GuildAssetRepository {
  /**
   * Find guild assets by their IDs
   */
  findByIds(assetIds: string[]): Promise<GuildAsset[]>;

  /**
   * Upsert a guild asset (emoji or sticker)
   */
  upsert(asset: Omit<GuildAsset, "id"> & { id: string }): Promise<void>;

  /**
   * Batch upsert multiple guild assets
   */
  upsertMany(assets: (Omit<GuildAsset, "id"> & { id: string })[]): Promise<void>;
}