import type { Guild, GuildAuditLogsEntry, GuildAuditLogsEntryExtraField } from "discord.js";
import { AuditLogEvent, EmbedBuilder, Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { MessageDeleteAuditLogCache } from "../../application/MessageDeleteAuditLogCache";

/**
 * Listens for audit log MessageDelete entries and enriches already-sent
 * message log embeds with the executor (who deleted the message).
 *
 * Only fires when someone deletes another user's message — self-deletes
 * produce no audit log entry and are unaffected.
 */
export class MessageDeleteAuditLogHandler extends EventHandler<Events.GuildAuditLogEntryCreate> {
  constructor(
    private readonly cache: MessageDeleteAuditLogCache,
    private readonly logger: Logger,
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

    const channelId = extra.channel.id;

    const pending = this.cache.getAndClear(
      guild.id,
      channelId,
      entry.targetId,
    );

    if (!pending) {
      this.logger.info(
        {
          guildId: guild.id,
          channelId,
          targetUserId: entry.targetId,
          executorId: entry.executor.id,
        },
        "Audit log message delete has no matching pending log message (may have expired or arrived before MessageDelete event)",
      );
      return;
    }

    try {
      const enrichedEmbed = EmbedBuilder.from(pending.embedData).addFields([
        {
          name: "Deleted by",
          value: `<@${entry.executor.id}> (${entry.executor.tag})`,
          inline: true,
        },
      ]);

      await pending.sentMessage.edit({ embeds: [enrichedEmbed.toJSON()] });
    } catch (err) {
      this.logger.warn(
        {
          err,
          guildId: guild.id,
          channelId,
          targetUserId: entry.targetId,
          executorId: entry.executor.id,
        },
        "Failed to edit message log embed with executor info",
      );
    }
  }
}
