import type { Client, GuildEmoji, Sticker, Guild } from "discord.js";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import type { GuildAssetRepository, GuildAsset } from "../domain";

const logger = newModuleLogger("GuildAssetSyncService");

export class GuildAssetSyncService {
  constructor(
    private guildAssetRepository: GuildAssetRepository,
    private client: Client,
  ) {}

  /**
   * Sync all emojis and stickers from all guilds the bot is in
   */
  async syncAllGuildAssets(): Promise<void> {
    logger.info(
      { guildsCount: this.client.guilds.cache.size },
      "Starting sync of all guild emojis and stickers",
    );

    let totalEmojiCount = 0;
    let totalStickerCount = 0;

    try {
      for (const guild of this.client.guilds.cache.values()) {
        const { emojiCount, stickerCount } = await this.syncGuildAssets(guild);
        totalEmojiCount += emojiCount;
        totalStickerCount += stickerCount;
      }

      logger.info(
        { totalEmojiCount, totalStickerCount },
        "Completed sync of all guild assets",
      );
    } catch (err) {
      logger.error({ err }, "Failed to sync all guild assets");
      throw err;
    }
  }

  /**
   * Sync emojis and stickers for a specific guild
   */
  async syncGuildAssets(guild: Guild): Promise<{ emojiCount: number; stickerCount: number }> {
    try {
      const emojis = Array.from(guild.emojis.cache.values());
      const stickers = Array.from(guild.stickers.cache.values());

      const assets: (Omit<GuildAsset, "id"> & { id: string })[] = [];

      // Add emojis
      for (const emoji of emojis) {
        assets.push({
          id: emoji.id,
          guildId: guild.id,
          name: emoji.name || "",
          type: "emoji",
        });
      }

      // Add stickers
      for (const sticker of stickers) {
        assets.push({
          id: sticker.id,
          guildId: guild.id,
          name: sticker.name,
          type: "sticker",
        });
      }

      if (assets.length > 0) {
        await this.guildAssetRepository.upsertMany(assets);
      }

      logger.debug(
        {
          guildId: guild.id,
          guildName: guild.name,
          emojiCount: emojis.length,
          stickerCount: stickers.length,
        },
        "Synced guild assets",
      );

      return {
        emojiCount: emojis.length,
        stickerCount: stickers.length,
      };
    } catch (err) {
      logger.error(
        { err, guildId: guild.id, guildName: guild.name },
        "Failed to sync guild assets",
      );
      throw err;
    }
  }

  /**
   * Sync a single emoji
   */
  async syncEmoji(emoji: GuildEmoji): Promise<void> {
    try {
      await this.guildAssetRepository.upsert({
        id: emoji.id,
        guildId: emoji.guild.id,
        name: emoji.name || "",
        type: "emoji",
      });

      logger.debug(
        { emojiId: emoji.id, guildId: emoji.guild.id, name: emoji.name },
        "Synced emoji",
      );
    } catch (err) {
      logger.error(
        { err, emojiId: emoji.id, guildId: emoji.guild.id },
        "Failed to sync emoji",
      );
      throw err;
    }
  }

  /**
   * Sync a single sticker
   */
  async syncSticker(sticker: Sticker): Promise<void> {
    if (!sticker.guildId) {
      return; // Skip non-guild stickers
    }

    try {
      await this.guildAssetRepository.upsert({
        id: sticker.id,
        guildId: sticker.guildId,
        name: sticker.name,
        type: "sticker",
      });

      logger.debug(
        { stickerId: sticker.id, guildId: sticker.guildId, name: sticker.name },
        "Synced sticker",
      );
    } catch (err) {
      logger.error(
        { err, stickerId: sticker.id, guildId: sticker.guildId },
        "Failed to sync sticker",
      );
      throw err;
    }
  }
}