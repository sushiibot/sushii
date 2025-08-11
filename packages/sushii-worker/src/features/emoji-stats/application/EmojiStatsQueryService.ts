import { newModuleLogger } from "@/shared/infrastructure/logger";
import type {
  EmojiStickerStatsRepository,
  StatsQueryOptions,
  PaginatedStatsResult,
} from "../domain";

const logger = newModuleLogger("EmojiStatsQueryService");

export interface QueryStatsRequest {
  guildId: string;
  assetType?: "emoji" | "sticker" | "both";
  actionType?: "message" | "reaction" | "sum";
  serverUsage?: "internal" | "external" | "sum";
  order?: "high_to_low" | "low_to_high";
  emojiType?: "animated" | "static" | "both";
  limit?: number;
  offset?: number;
}

export class EmojiStatsQueryService {
  constructor(private statsRepository: EmojiStickerStatsRepository) {}

  async queryStats(request: QueryStatsRequest): Promise<PaginatedStatsResult> {
    const {
      guildId,
      assetType = "emoji",
      actionType = "sum",
      serverUsage = "internal",
      order = "high_to_low",
      emojiType = "both",
      limit = 25,
      offset = 0,
    } = request;

    logger.debug(
      { guildId, assetType, actionType, serverUsage, order, emojiType, limit, offset },
      "Querying emoji/sticker stats",
    );

    try {
      const options: StatsQueryOptions = {
        guildId,
        assetType,
        actionType,
        serverUsage,
        order,
        emojiType,
        limit,
        offset,
      };

      const result = await this.statsRepository.queryStats(options);

      logger.debug(
        { guildId, resultCount: result.results.length, totalCount: result.totalCount, hasMore: result.hasMore },
        "Stats query completed",
      );

      return result;
    } catch (err) {
      logger.error(
        { err, guildId, assetType, actionType },
        "Failed to query stats",
      );
      throw new Error("Failed to retrieve emoji/sticker statistics");
    }
  }
}