import type { GuildBan } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { LegacyAuditLogNotificationService } from "../../application/LegacyAuditLogNotificationService";

/**
 * Event handler for Guild Ban Add events.
 * Checks for missing audit log permissions and notifies guilds when needed.
 */
export class LegacyAuditLogNotificationHandler extends EventHandler<Events.GuildBanAdd> {
  constructor(
    private readonly notificationService: LegacyAuditLogNotificationService,
    private readonly logger: Logger,
  ) {
    super();
  }

  readonly eventType = Events.GuildBanAdd;

  async handle(ban: GuildBan): Promise<void> {
    try {
      await this.notificationService.handleBanEvent(ban);
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId: ban.guild.id,
        },
        "Failed to handle legacy audit log notification",
      );
    }
  }
}