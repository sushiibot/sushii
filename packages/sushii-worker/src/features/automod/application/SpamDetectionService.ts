import { createHash } from "node:crypto";
import type { Logger } from "pino";

interface MessageEntry {
  contentHash: string;
  channelId: string;
  timestamp: number;
}

export class SpamDetectionService {
  // Per guild: Map<guildId, Map<userId, MessageEntry[]>>
  private readonly spamTracking = new Map<
    string,
    Map<string, MessageEntry[]>
  >();
  private readonly cleanupInterval: Timer;

  constructor(private readonly logger: Logger) {
    // Cleanup inactive users every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveUsers();
    }, 30000);
  }

  /**
   * Check if a message should be considered spam
   * @param guildId - Discord guild ID
   * @param userId - Discord user ID
   * @param content - Message content to check
   * @param channelId - Channel where message was sent
   * @returns True if this message triggers spam detection (3+ channels with same content)
   */
  checkForSpam(
    guildId: string,
    userId: string,
    content: string,
    channelId: string,
  ): boolean {
    // Skip empty messages
    if (!content.trim()) {
      return false;
    }

    const now = Date.now();
    const contentHash = this.hashContent(content);

    // Get or create guild tracking
    let guildMap = this.spamTracking.get(guildId);
    if (!guildMap) {
      guildMap = new Map();
      this.spamTracking.set(guildId, guildMap);
    }

    // Get user's message queue and clean up old messages
    const userQueue = this.cleanupUserMessages(guildMap, userId, now);

    // Add the new message
    userQueue.push({
      contentHash,
      channelId,
      timestamp: now,
    });

    // Count unique channels for this content hash in recent messages
    const channelsWithContent = new Set<string>();
    for (const message of userQueue) {
      if (message.contentHash === contentHash) {
        channelsWithContent.add(message.channelId);
      }
    }

    const isSpam = channelsWithContent.size >= 3;

    if (isSpam) {
      this.logger.info(
        {
          guildId,
          userId,
          channelCount: channelsWithContent.size,
          channels: Array.from(channelsWithContent),
          contentHash,
        },
        "Spam detected: same content in multiple channels",
      );
    }

    return isSpam;
  }

  /**
   * Clean up old messages for a specific user and return their current queue
   */
  private cleanupUserMessages(
    guildMap: Map<string, MessageEntry[]>,
    userId: string,
    now: number,
  ): MessageEntry[] {
    const cutoff = now - 5000; // 5 seconds ago
    const userQueue = guildMap.get(userId) || [];

    // Filter to only recent messages
    const recentMessages = userQueue.filter((msg) => msg.timestamp > cutoff);

    if (recentMessages.length === 0) {
      // Remove empty user entry
      guildMap.delete(userId);
    } else {
      guildMap.set(userId, recentMessages);
    }

    return recentMessages;
  }

  /**
   * Periodic cleanup of inactive users across all guilds
   */
  private cleanupInactiveUsers(): void {
    const now = Date.now();
    const cutoff = now - 5000; // 5 seconds ago

    for (const [guildId, guildMap] of this.spamTracking) {
      for (const [userId, messageQueue] of guildMap) {
        // Check if ANY message in queue is recent
        const hasRecentMessages = messageQueue.some(
          (msg) => msg.timestamp > cutoff,
        );

        if (!hasRecentMessages) {
          guildMap.delete(userId);
        }
      }

      // Remove empty guild entries
      if (guildMap.size === 0) {
        this.spamTracking.delete(guildId);
      }
    }

    this.logger.trace(
      {
        activeGuilds: this.spamTracking.size,
        totalUsers: Array.from(this.spamTracking.values()).reduce(
          (total, guildMap) => total + guildMap.size,
          0,
        ),
      },
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
   * Get current tracking stats (for debugging)
   */
  getStats(): { activeGuilds: number; totalUsers: number } {
    return {
      activeGuilds: this.spamTracking.size,
      totalUsers: Array.from(this.spamTracking.values()).reduce(
        (total, guildMap) => total + guildMap.size,
        0,
      ),
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.spamTracking.clear();
  }
}
