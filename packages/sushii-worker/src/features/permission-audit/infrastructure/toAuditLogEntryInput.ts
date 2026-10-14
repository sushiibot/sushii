import type { GuildAuditLogsEntry } from "discord.js";
import { ThreadChannel } from "discord.js";

import type { AuditLogEntryInput } from "../domain/detectors/AuditLogUsageDetector";

export function toAuditLogEntryInput(
  entry: GuildAuditLogsEntry,
  guildId: string,
): AuditLogEntryInput {
  return {
    guildId,
    action: entry.action,
    executorId: entry.executorId,
    targetId: entry.targetId,
    channelId: extraChannelId(entry.extra),
    changeKeys: entry.changes.map((change) => change.key),
    occurredAt: entry.createdAt,
    targetOwnerId:
      entry.target instanceof ThreadChannel ? entry.target.ownerId : null,
  };
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
