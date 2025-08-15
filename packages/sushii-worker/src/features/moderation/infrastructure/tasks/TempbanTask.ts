import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type { TempBanRepository } from "@/features/moderation/shared/domain/repositories/TempBanRepository";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import { AbstractBackgroundTask } from "@/tasks/AbstractBackgroundTask";
import toTimestamp from "@/utils/toTimestamp";

export class TempbanTask extends AbstractBackgroundTask {
  readonly name = "Unban expired tempbans";
  readonly cronTime = "*/30 * * * * *"; // Every 30 seconds

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    private readonly tempBanRepository: TempBanRepository,
  ) {
    super(client, deploymentService, newModuleLogger("TempbansTask"));
  }

  protected async execute(): Promise<void> {
    const tempBansResult = await this.tempBanRepository.deleteExpired();

    if (!tempBansResult.ok) {
      this.logger.error(
        { error: tempBansResult.val },
        "Failed to get and delete expired temp bans",
      );
      return;
    }

    const tempBans = tempBansResult.val;

    this.logger.debug(
      {
        tempBans: tempBans.length,
      },
      "Unbanning expired tempbans",
    );

    for (const tempBan of tempBans) {
      try {
        // Do not use client.guilds.cache, as this task runs only on shard 0
        // so other guilds will not be cached.

        const guild = await this.client.guilds.fetch(tempBan.guildId);
        const ts = toTimestamp(tempBan.createdAt);
        await guild.members.unban(
          tempBan.userId,
          `Tempban from ${ts} expired.`,
        );

        this.logger.info(
          {
            guildId: tempBan.guildId,
            userId: tempBan.userId,
          },
          "Successfully unbanned expired temp ban",
        );
      } catch (error) {
        // Ignore any errors -- either no perms or user was manually unbanned, etc
        this.logger.debug(
          {
            guildId: tempBan.guildId,
            userId: tempBan.userId,
            error,
          },
          "Failed to unban user (probably already unbanned or no permissions)",
        );

        continue;
      }
    }
  }
}
