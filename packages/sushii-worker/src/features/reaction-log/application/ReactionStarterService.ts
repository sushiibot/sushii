import type { Logger } from "pino";

import type { ReactionStarterRepository } from "../domain/repositories/ReactionStarterRepository";

export class ReactionStarterService {
  constructor(
    private readonly repository: ReactionStarterRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Get or set the starter for a reaction emoji on a message
   * Returns the starter user ID and whether this is a new reaction
   */
  async getOrSetStarter(
    messageId: string,
    emoji: string,
    userId: string,
    guildId: string,
  ): Promise<{ starterId: string; isNew: boolean }> {
    try {
      const existing = await this.repository.getStarter(messageId, emoji);
      if (existing) {
        this.logger.trace(
          { messageId, emoji, existing },
          "Found reaction starter in database",
        );
        return { starterId: existing, isNew: false };
      }

      // Save as new starter
      await this.repository.saveStarter(messageId, emoji, userId, guildId);

      this.logger.trace(
        { messageId, emoji, userId },
        "New reaction starter created",
      );
      return { starterId: userId, isNew: true };
    } catch (err) {
      this.logger.error(
        { err, messageId, emoji, userId, guildId },
        "Failed to get or set reaction starter",
      );
      // Fallback: treat as existing reaction with current user as starter
      // This prevents the reaction from being lost entirely
      return { starterId: userId, isNew: false };
    }
  }
}
