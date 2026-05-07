interface SpamAlertEntry {
  channelId: string;
  messageId: string;
  timestamp: number;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * In-memory cache for sushii's own spam detection alert messages.
 * Keyed by guildId → userId. Only the latest alert per user is stored.
 * Entries are consumed and removed when read to prevent stale double-edits.
 */
export class SpamAlertCache {
  private readonly cache = new Map<string, Map<string, SpamAlertEntry>>();

  track(
    guildId: string,
    userId: string,
    channelId: string,
    messageId: string,
  ): void {
    let guildMap = this.cache.get(guildId);
    if (!guildMap) {
      guildMap = new Map();
      this.cache.set(guildId, guildMap);
    }
    guildMap.set(userId, { channelId, messageId, timestamp: Date.now() });
  }

  consume(guildId: string, userId: string): SpamAlertEntry | null {
    const guildMap = this.cache.get(guildId);
    if (!guildMap) {
      return null;
    }

    const entry = guildMap.get(userId);
    if (!entry) {
      return null;
    }

    const cutoff = Date.now() - MAX_AGE_MS;
    guildMap.delete(userId);
    if (guildMap.size === 0) {
      this.cache.delete(guildId);
    }

    if (entry.timestamp < cutoff) {
      return null;
    }

    return entry;
  }
}
