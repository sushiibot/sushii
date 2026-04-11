interface AutomodAlertEntry {
  messageId: string;
  channelId: string;
  timestamp: number;
}

const MAX_ENTRIES_PER_USER = 5;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Bounded in-memory cache for native Discord AutoMod alert messages.
 * Keyed by guildId → userId → list of recent alert entries.
 * Entries are consumed and removed when read (no background timer needed).
 */
export class AutomodAlertCache {
  private readonly cache = new Map<string, Map<string, AutomodAlertEntry[]>>();

  track(
    guildId: string,
    userId: string,
    messageId: string,
    channelId: string,
  ): void {
    let guildMap = this.cache.get(guildId);
    if (!guildMap) {
      guildMap = new Map();
      this.cache.set(guildId, guildMap);
    }

    const cutoff = Date.now() - MAX_AGE_MS;
    const existing = guildMap.get(userId) ?? [];

    // Prune stale entries on write so unread users don't accumulate forever
    const fresh = existing.filter((e) => e.timestamp >= cutoff);
    fresh.push({ messageId, channelId, timestamp: Date.now() });

    // Keep only the most recent entries
    if (fresh.length > MAX_ENTRIES_PER_USER) {
      fresh.splice(0, fresh.length - MAX_ENTRIES_PER_USER);
    }

    guildMap.set(userId, fresh);
  }

  consumeRecent(guildId: string, userId: string): readonly AutomodAlertEntry[] {
    const guildMap = this.cache.get(guildId);
    if (!guildMap) return [];

    const entries = guildMap.get(userId);
    if (!entries) return [];

    const cutoff = Date.now() - MAX_AGE_MS;
    const recent = entries.filter((e) => e.timestamp >= cutoff);

    // Remove consumed entries; clean up guild map if now empty
    guildMap.delete(userId);
    if (guildMap.size === 0) {
      this.cache.delete(guildId);
    }

    return recent;
  }
}
