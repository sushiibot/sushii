import type { Guild, GuildAuditLogsEntry, GuildAuditLogsEntryExtraField } from "discord.js";
import { AuditLogEvent, Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { MessageDeleteAuditLogCache } from "../../application/MessageDeleteAuditLogCache";

/**
 * Listens for audit log MessageDelete entries and notifies any waiting
 * MessageLogService.processDeleteEvent calls with executor info.
 *
 * Only fires when someone deletes another user's message — self-deletes
 * produce no audit log entry.
 */
export class MessageDeleteAuditLogHandler extends EventHandler<Events.GuildAuditLogEntryCreate> {
  constructor(
    private readonly cache: MessageDeleteAuditLogCache,
  ) {
    super();
  }

  readonly eventType = Events.GuildAuditLogEntryCreate;

  async handle(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
    if (entry.action !== AuditLogEvent.MessageDelete) return;
    if (!entry.targetId || !entry.executor) return;

    // TypeScript doesn't narrow entry.extra based on entry.action for the broad
    // GuildAuditLogsEntry type, so cast to the correct extra shape.
    const extra = entry.extra as GuildAuditLogsEntryExtraField[AuditLogEvent.MessageDelete] | null;
    if (!extra) return;

    this.cache.notifyExecutor(guild.id, extra.channel.id, entry.targetId, {
      executorId: entry.executor.id,
      executorUsername: entry.executor.username ?? entry.executor.id,
    });
  }
}
