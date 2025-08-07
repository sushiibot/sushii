import { Client } from "discord.js";

import { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { TempBanRepository } from "@/features/moderation/shared/domain/repositories/TempBanRepository";
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
      const guild = this.client.guilds.cache.get(tempBan.guildId);
      if (!guild) {
        // Might be a guild that the bot is no longer in
        this.logger.debug(
          {
            guildId: tempBan.guildId,
            userId: tempBan.userId,
          },
          "Guild not found for temp ban, skipping",
        );
        continue;
      }

      const ts = toTimestamp(tempBan.createdAt);

      try {
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
