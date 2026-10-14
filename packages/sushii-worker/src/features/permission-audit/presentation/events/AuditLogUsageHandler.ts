import type { Guild, GuildAuditLogsEntry } from "discord.js";
import { Events, ThreadChannel } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { PermissionUsageRecorder } from "../../application/PermissionUsageRecorder";

export class AuditLogUsageHandler extends EventHandler<Events.GuildAuditLogEntryCreate> {
  readonly eventType = Events.GuildAuditLogEntryCreate;

  constructor(private readonly recorder: PermissionUsageRecorder) {
    super();
  }

  async handle(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
    await this.recorder.recordAuditLogEntry({
      guildId: guild.id,
      action: entry.action,
      executorId: entry.executorId,
      targetId: entry.targetId,
      channelId: extraChannelId(entry.extra),
      changeKeys: entry.changes.map((change) => change.key),
      occurredAt: entry.createdAt,
      targetOwnerId:
        entry.target instanceof ThreadChannel ? entry.target.ownerId : null,
    });
  }
}

function extraChannelId(extra: unknown): string | null {
  if (typeof extra !== "object" || extra === null || !("channel" in extra)) {
    return null;
  }

  const { channel } = extra;
  if (typeof channel === "object" && channel !== null && "id" in channel) {
    return typeof channel.id === "string" ? channel.id : null;
  }

  return null;
}
