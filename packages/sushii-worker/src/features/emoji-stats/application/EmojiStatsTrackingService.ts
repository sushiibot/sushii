import { newModuleLogger } from "@/shared/infrastructure/logger";

import {
  EMOJI_RE,
  type EmojiStickerStatsRepository,
  type GuildAssetRepository,
  type RateLimitService,
  type UsageData,
} from "../domain";

const logger = newModuleLogger("EmojiStatsTrackingService");

export interface TrackUsageRequest {
  userId: string;
  guildId: string;
  actionType: "message" | "reaction";
  emojiIds?: string[];
  stickerIds?: string[];
  messageContent?: string; // For extracting emojis from message
}

export class EmojiStatsTrackingService {
  constructor(
    private guildAssetRepository: GuildAssetRepository,
    private statsRepository: EmojiStickerStatsRepository,
    private rateLimitService: RateLimitService,
  ) {}

  async trackUsage(request: TrackUsageRequest): Promise<void> {
    const { userId, guildId, actionType } = request;

    // Extract asset IDs from various sources
    const assetIds = this.extractAssetIds(request);

    if (assetIds.length === 0) {
      return;
    }

    logger.trace(
      { userId, guildId, actionType, assetCount: assetIds.length },
      "Processing usage tracking request",
    );

    try {
      // Check rate limits
      const usageAttempts = assetIds.map((assetId) => ({ assetId }));
      const eligibleAttempts =
        await this.rateLimitService.filterRateLimitedUsage(
          userId,
          actionType,
          usageAttempts,
        );

      if (eligibleAttempts.length === 0) {
        logger.debug(
          { userId, guildId, actionType },
          "All attempts rate limited",
        );
        return;
      }

      const eligibleAssetIds = eligibleAttempts.map((a) => a.assetId);

      // Get known assets from database
      const knownAssets =
        await this.guildAssetRepository.findByIds(eligibleAssetIds);

      if (knownAssets.length === 0) {
        logger.debug(
          { userId, guildId, actionType, assetIds: eligibleAssetIds },
          "No known assets found",
        );
        return;
      }

      // Create usage data based on whether assets are from current guild or external
      const usageData: UsageData[] = knownAssets.map((asset) => {
        const isInternal = asset.guildId === guildId;
        return {
          guildId,
          assetId: asset.id,
          count: isInternal ? 1 : 0,
          countExternal: isInternal ? 0 : 1,
        };
      });

      // Track usage and record rate limits
      await Promise.all([
        this.statsRepository.incrementUsage(actionType, usageData),
        this.rateLimitService.recordRateLimits(
          userId,
          actionType,
          knownAssets.map((a) => a.id),
        ),
      ]);

      logger.debug(
        {
          userId,
          guildId,
          actionType,
          trackedCount: usageData.length,
          internalCount: usageData.filter((u) => u.count > 0).length,
          externalCount: usageData.filter((u) => u.countExternal > 0).length,
        },
        "Usage tracking completed",
      );
    } catch (err) {
      logger.error(
        { err, userId, guildId, actionType, assetIds },
        "Failed to track usage",
      );
      // Don't rethrow - usage tracking failures shouldn't break the bot
    }
  }

  private extractAssetIds(request: TrackUsageRequest): string[] {
    const assetIds: string[] = [];

    // Add emoji IDs
    if (request.emojiIds) {
      assetIds.push(...request.emojiIds);
    }

    // Add sticker IDs
    if (request.stickerIds) {
      assetIds.push(...request.stickerIds);
    }

    // Extract emojis from message content
    if (request.messageContent) {
      const matches = request.messageContent.matchAll(EMOJI_RE);
      const uniqueEmojiIds = new Set<string>();

      for (const match of matches) {
        const emojiId = match.groups?.id;
        if (emojiId) {
          uniqueEmojiIds.add(emojiId);
        }
      }

      assetIds.push(...Array.from(uniqueEmojiIds));
    }

    // Remove duplicates
    return Array.from(new Set(assetIds));
  }
}
