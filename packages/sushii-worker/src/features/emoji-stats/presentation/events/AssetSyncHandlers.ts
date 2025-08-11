import type { Client, GuildEmoji, Sticker } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import { newModuleLogger } from "@/shared/infrastructure/logger";

import type { GuildAssetSyncService } from "../../application";

const logger = newModuleLogger("AssetSyncHandlers");

export class ClientReadyAssetSyncHandler extends EventHandler<Events.ClientReady> {
  eventType = Events.ClientReady as const;

  constructor(private guildAssetSyncService: GuildAssetSyncService) {
    super();
  }

  async handle(client: Client<true>): Promise<void> {
    logger.info(
      { guildsCount: client.guilds.cache.size },
      "Syncing all guild emojis and stickers",
    );

    try {
      await this.guildAssetSyncService.syncAllGuildAssets();
    } catch (err) {
      logger.error({ err }, "Failed to sync guild assets on ready");
    }
  }
}

export class EmojiCreateSyncHandler extends EventHandler<Events.GuildEmojiCreate> {
  eventType = Events.GuildEmojiCreate as const;

  constructor(private guildAssetSyncService: GuildAssetSyncService) {
    super();
  }

  async handle(emoji: GuildEmoji): Promise<void> {
    try {
      await this.guildAssetSyncService.syncEmoji(emoji);
    } catch (err) {
      logger.error(
        { err, emojiId: emoji.id, guildId: emoji.guild.id },
        "Failed to sync emoji on create",
      );
    }
  }
}

export class EmojiUpdateSyncHandler extends EventHandler<Events.GuildEmojiUpdate> {
  eventType = Events.GuildEmojiUpdate as const;

  constructor(private guildAssetSyncService: GuildAssetSyncService) {
    super();
  }

  async handle(_oldEmoji: GuildEmoji, newEmoji: GuildEmoji): Promise<void> {
    try {
      await this.guildAssetSyncService.syncEmoji(newEmoji);
    } catch (err) {
      logger.error(
        { err, emojiId: newEmoji.id, guildId: newEmoji.guild.id },
        "Failed to sync emoji on update",
      );
    }
  }
}

export class StickerCreateSyncHandler extends EventHandler<Events.GuildStickerCreate> {
  eventType = Events.GuildStickerCreate as const;

  constructor(private guildAssetSyncService: GuildAssetSyncService) {
    super();
  }

  async handle(sticker: Sticker): Promise<void> {
    try {
      await this.guildAssetSyncService.syncSticker(sticker);
    } catch (err) {
      logger.error(
        { err, stickerId: sticker.id, guildId: sticker.guildId },
        "Failed to sync sticker on create",
      );
    }
  }
}

export class StickerUpdateSyncHandler extends EventHandler<Events.GuildStickerUpdate> {
  eventType = Events.GuildStickerUpdate as const;

  constructor(private guildAssetSyncService: GuildAssetSyncService) {
    super();
  }

  async handle(_oldSticker: Sticker, newSticker: Sticker): Promise<void> {
    try {
      await this.guildAssetSyncService.syncSticker(newSticker);
    } catch (err) {
      logger.error(
        { err, stickerId: newSticker.id, guildId: newSticker.guildId },
        "Failed to sync sticker on update",
      );
    }
  }
}
