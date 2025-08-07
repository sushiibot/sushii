import { Events, Guild, GuildAuditLogsEntry } from "discord.js";
import { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import { DiscordAuditLogService } from "../../infrastructure";

/**
 * Presentation layer event handler for Discord audit log entries.
 * Adapts Discord.js events to the moderation DDD architecture.
 */
export class AuditLogEventHandler extends EventHandler<Events.GuildAuditLogEntryCreate> {
  constructor(
    private readonly discordAuditLogService: DiscordAuditLogService,
    private readonly logger: Logger,
  ) {
    super();
  }

  readonly eventType = Events.GuildAuditLogEntryCreate;

  /**
   * Creates an event handler function for Discord.js event registration.
   */
  async handle(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
    try {
      const result = await this.discordAuditLogService.handleAuditLogEntry(
        entry,
        guild,
      );

      if (result.err) {
        this.logger.error(
          {
            err: result.val,
            guildId: guild.id,
            action: entry.action,
            targetId: entry.targetId,
          },
          "Failed to handle audit log entry",
        );
      }
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId: guild.id,
          action: entry.action,
          targetId: entry.targetId,
        },
        "Unexpected error in audit log event handler",
      );
    }
  }
}
