import type { APIEmbed } from "discord.js";
import type { Message } from "discord.js";

const TTL_MS = 10_000;

interface PendingEntry {
  sentMessage: Message;
  embedData: APIEmbed;
  expiresAt: number;
}

/**
 * Short-lived cache of sent message log embeds waiting to be enriched with
 * audit log executor info. Keyed by guildId:channelId:targetUserId.
 *
 * When a moderator deletes another user's message, Discord emits:
 *  1. MessageDelete gateway event (fast)
 *  2. GuildAuditLogEntryCreate event (slower)
 *
 * The message log embed is sent on (1) and stored here. When (2) arrives,
 * the embed is edited to include "Deleted by" info.
 */
export class MessageDeleteAuditLogCache {
  private readonly pending = new Map<string, PendingEntry>();

  private key(
    guildId: string,
    channelId: string,
    targetUserId: string,
  ): string {
    return `${guildId}:${channelId}:${targetUserId}`;
  }

  set(
    guildId: string,
    channelId: string,
    targetUserId: string,
    sentMessage: Message,
    embedData: APIEmbed,
  ): void {
    this.pending.set(this.key(guildId, channelId, targetUserId), {
      sentMessage,
      embedData,
      expiresAt: Date.now() + TTL_MS,
    });
  }

  /**
   * Returns and removes the pending entry if it exists and hasn't expired.
   */
  getAndClear(
    guildId: string,
    channelId: string,
    targetUserId: string,
  ): PendingEntry | null {
    const k = this.key(guildId, channelId, targetUserId);
    const entry = this.pending.get(k);
    if (!entry) return null;
    this.pending.delete(k);
    if (entry.expiresAt < Date.now()) return null;
    return entry;
  }
}
