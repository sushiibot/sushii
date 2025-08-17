import type { Guild, GuildAuditLogsEntry } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";

import type { AuditLogOrchestrationService } from "../application";

/**
 * Infrastructure service that handles Discord.js integration for audit log processing.
 * Delegates business logic to the application layer.
 */
export class DiscordAuditLogService {
  constructor(
    private readonly auditLogOrchestrationService: AuditLogOrchestrationService,
    private readonly logger: Logger,
  ) {}

  /**
   * Handles Discord audit log entries by delegating to the application service.
   */
  async handleAuditLogEntry(
    entry: GuildAuditLogsEntry,
    guild: Guild,
  ): Promise<Result<void, string>> {
    this.logger.trace(
      {
        guildId: guild.id,
        entryAction: entry.action,
        entryId: entry.id,
      },
      "Processing Discord audit log entry",
    );

    return this.auditLogOrchestrationService.handleAuditLogEntry(entry, guild);
  }
}
