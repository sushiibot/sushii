import { createHash } from "node:crypto";
import type { Logger } from "pino";

interface ChannelRecord {
  messageId: string;
  timestamp: number;
}

// contentHash -> channelId -> ChannelRecord[]
type ContentHashTracker = Map<string, Map<string, ChannelRecord[]>>;

export class SpamDetectionService {
  static readonly SPAM_WINDOW_MS = 5000;
  private static readonly CLEANUP_INTERVAL_MS = 30000;
  private static readonly SPAM_CHANNEL_THRESHOLD = 3;

  // Per guild: Map<guildId, Map<userId, ContentHashTracker>>
  private readonly spamTracking = new Map<
    string,
    Map<string, ContentHashTracker>
  >();
  private readonly cleanupInterval: Timer;

  constructor(private readonly logger: Logger) {
    // Cleanup inactive users every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveUsers();
    }, SpamDetectionService.CLEANUP_INTERVAL_MS);
  }

  /**
   * Check if a message should be considered spam
   * @param guildId - Discord guild ID
   * @param userId - Discord user ID
   * @param spamKey - Message content key to check
   * @param channelId - Channel where message was sent
   * @param messageId - ID of the message being checked
   * @returns null if not spam; Map<channelId, messageId[]> if spam detected (3+ channels)
   */
  checkForSpam(
    guildId: string,
    userId: string,
    spamKey: string,
    channelId: string,
    messageId: string,
  ): Map<string, string[]> | null {
    const now = Date.now();
    const cutoff = now - SpamDetectionService.SPAM_WINDOW_MS;
    const contentHash = this.hashContent(spamKey);

    // Get or create guild map
    let guildMap = this.spamTracking.get(guildId);
    if (!guildMap) {
      guildMap = new Map();
      this.spamTracking.set(guildId, guildMap);
    }

    // Get or create user's content hash tracker
    let contentHashTracker = guildMap.get(userId);
    if (!contentHashTracker) {
      contentHashTracker = new Map();
      guildMap.set(userId, contentHashTracker);
    }

    // Get or create channel map for this content hash
    let channelMap = contentHashTracker.get(contentHash);
    if (!channelMap) {
      channelMap = new Map();
      contentHashTracker.set(contentHash, channelMap);
    }

    // Get or create records for this channel, filter stale, add new entry
    const existing = channelMap.get(channelId) ?? [];
    const recent = existing.filter((r) => r.timestamp > cutoff);
    recent.push({ messageId, timestamp: now });
    channelMap.set(channelId, recent);

    // Count channels with at least one recent record for this content hash
    let channelCount = 0;
    for (const records of channelMap.values()) {
      if (records.some((r) => r.timestamp > cutoff)) {
        channelCount++;
      }
    }

    if (channelCount < SpamDetectionService.SPAM_CHANNEL_THRESHOLD) {
      return null;
    }

    // Collect all message IDs per channel for bulk delete
    const spamMessages = new Map<string, string[]>();
    for (const [cId, records] of channelMap) {
      const recentRecords = records.filter((r) => r.timestamp > cutoff);
      if (recentRecords.length > 0) {
        spamMessages.set(
          cId,
          recentRecords.map((r) => r.messageId),
        );
      }
    }

    // Clear user tracking immediately to prevent redundant concurrent timeout calls
    guildMap.delete(userId);

    this.logger.info(
      {
        guildId,
        userId,
        channelCount: spamMessages.size,
        channels: Array.from(spamMessages.keys()),
        contentHash,
      },
      "Spam detected: same content in multiple channels",
    );

    return spamMessages;
  }

  /**
   * Periodic cleanup of inactive users across all guilds
   */
  private cleanupInactiveUsers(): void {
    const now = Date.now();
    const cutoff = now - SpamDetectionService.SPAM_WINDOW_MS;

    for (const [guildId, guildMap] of this.spamTracking) {
      for (const [userId, contentHashTracker] of guildMap) {
        for (const [hash, channelMap] of contentHashTracker) {
          for (const [cId, records] of channelMap) {
            const fresh = records.filter((r) => r.timestamp > cutoff);
            if (fresh.length === 0) {
              channelMap.delete(cId);
            } else {
              channelMap.set(cId, fresh);
            }
          }
          if (channelMap.size === 0) {
            contentHashTracker.delete(hash);
          }
        }
        if (contentHashTracker.size === 0) {
          guildMap.delete(userId);
        }
      }
      if (guildMap.size === 0) {
        this.spamTracking.delete(guildId);
      }
    }

    let totalUsers = 0;
    for (const guildMap of this.spamTracking.values()) {
      totalUsers += guildMap.size;
    }

    this.logger.trace(
      { activeGuilds: this.spamTracking.size, totalUsers },
      "Completed spam tracking cleanup",
    );
  }

  /**
   * Create a simple hash of message content for comparison
   */
  private hashContent(content: string): string {
    const normalized = content.trim().toLowerCase();
    return createHash("md5").update(normalized).digest("hex");
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.spamTracking.clear();
  }
}
