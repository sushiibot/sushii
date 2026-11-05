import type { Client } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { SushiiUpdatesCaptureService } from "../../application/SushiiUpdatesCaptureService";
import type { SushiiUpdatesRelayService } from "../../application/SushiiUpdatesRelayService";

const SOURCE_ACCESS_ERRORS = new Set<number | string>([
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.UnknownChannel,
]);
const CATCH_UP_BACKOFF_MS = 30 * 60 * 1000;

/** Each cluster forwards to the guilds in its own cache; delivery rows are the claims, so two processes never send the same delivery. */
export class SushiiUpdatesRelayTask extends AbstractBackgroundTask {
  readonly name = "SushiiUpdatesRelay";
  readonly cronTime = "* * * * *";
  private catchUpBlockedUntil = 0;

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly sourceChannelId: string,
    private readonly capture: SushiiUpdatesCaptureService,
    private readonly relay: SushiiUpdatesRelayService,
  ) {
    super(client, deploymentService, logger);
  }

  shouldRunOnCluster(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    // Only the cluster that holds the support server does the global work.
    if (this.client.channels.cache.has(this.sourceChannelId)) {
      await this.runSourceClusterWork();
    }

    await this.relay.run({
      guildIds: () => [...this.client.guilds.cache.keys()],
      getGuild: (guildId) => this.client.guilds.cache.get(guildId),
      isActive: () => this.deploymentService.isCurrentDeploymentActive(),
    });
  }

  private async runSourceClusterWork(): Promise<void> {
    // Each step is independent, and forwarding already-captured posts shouldn't wait on either.
    const botUserId = this.client.user?.id;
    if (botUserId && Date.now() >= this.catchUpBlockedUntil) {
      try {
        await this.capture.catchUp(botUserId);
      } catch (err) {
        // A permission problem on the source channel is an operator fix, not a bug; warn once per backoff.
        if (
          err instanceof DiscordAPIError &&
          SOURCE_ACCESS_ERRORS.has(err.code)
        ) {
          this.catchUpBlockedUntil = Date.now() + CATCH_UP_BACKOFF_MS;
          this.logger.warn(
            { code: err.code, channelId: this.sourceChannelId },
            "sushii can't read the sushii updates channel; check View Channel and Read Message History",
          );
        } else {
          this.logger.error({ err }, "sushii updates catch-up failed");
        }
      }
    }
    try {
      await this.relay.housekeeping();
    } catch (err) {
      this.logger.error({ err }, "sushii updates cleanup failed");
    }
  }
}
