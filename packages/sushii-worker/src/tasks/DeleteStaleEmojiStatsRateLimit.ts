import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import dayjs from "@/shared/domain/dayjs";
import { newModuleLogger } from "@/shared/infrastructure/logger";

import { UserEmojiRateLimitDuration } from "../events/EmojiStatsHandler";
import db from "../infrastructure/database/db";
import { AbstractBackgroundTask } from "./AbstractBackgroundTask";

export class DeleteStaleEmojiStatsRateLimit extends AbstractBackgroundTask {
  readonly name = "Delete stale emoji stats rate limits";
  readonly cronTime = "0 0 * * *"; // Once a day

  constructor(client: Client, deploymentService: DeploymentService) {
    super(
      client,
      deploymentService,
      newModuleLogger("DeleteStaleEmojiStatsTask"),
    );
  }

  protected async execute(): Promise<void> {
    const deleted = await db
      .deleteFrom("app_public.emoji_sticker_stats_rate_limits")
      .where(
        "last_used",
        "<",
        dayjs().utc().subtract(UserEmojiRateLimitDuration).toDate(),
      )
      .executeTakeFirst();

    this.logger.info(
      "Deleted %d old emoji stats rate limits",
      deleted.numDeletedRows,
    );
  }
}
