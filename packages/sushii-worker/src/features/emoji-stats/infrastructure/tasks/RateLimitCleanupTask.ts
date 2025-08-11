import type { Client } from "discord.js";
import { lt } from "drizzle-orm";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import dayjs from "@/shared/domain/dayjs";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import { drizzleDb } from "@/infrastructure/database/db";
import { emojiStickerStatsRateLimitsInAppPublic } from "@/infrastructure/database/schema";
import { AbstractBackgroundTask } from "@/tasks/AbstractBackgroundTask";

import { USER_EMOJI_RATE_LIMIT_DURATION } from "../../domain/constants";

export class RateLimitCleanupTask extends AbstractBackgroundTask {
  readonly name = "Emoji Stats Rate Limit Cleanup";
  readonly cronTime = "0 0 * * *"; // Once a day at midnight

  constructor(client: Client, deploymentService: DeploymentService) {
    super(
      client,
      deploymentService,
      newModuleLogger("RateLimitCleanupTask"),
    );
  }

  protected async execute(): Promise<void> {
    const cutoffDate = dayjs()
      .utc()
      .subtract(USER_EMOJI_RATE_LIMIT_DURATION)
      .toISOString();
    
    this.logger.debug({ cutoffDate }, "Starting rate limit cleanup");

    const result = await drizzleDb
      .delete(emojiStickerStatsRateLimitsInAppPublic)
      .where(
        lt(emojiStickerStatsRateLimitsInAppPublic.lastUsed, cutoffDate),
      );

    const deletedCount = result.rowCount || 0;

    this.logger.info(
      { deletedCount, cutoffDate },
      "Completed rate limit cleanup",
    );
  }
}