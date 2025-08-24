import type { Logger } from "pino";

import type { ReactionStarterRepository } from "../domain/repositories/ReactionStarterRepository";

export class ReactionStarterService {
  constructor(
    private readonly repository: ReactionStarterRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Get or set the starter for a reaction emoji on a message
   * Returns all starters and whether this user is a new starter
   */
  async getOrSetStarter(
    messageId: string,
    emojiId: string,
    emojiName: string | null,
    userId: string,
    guildId: string,
  ): Promise<{ starters: string[]; isNew: boolean }> {
    try {
      const hasStarters = await this.repository.hasAnyStarter(
        messageId,
        emojiId,
      );
      if (hasStarters) {
        // Existing reaction - get all existing starters
        const starters = await this.repository.getStarters(messageId, emojiId);
        this.logger.trace(
          { messageId, emojiId, emojiName, starters },
          "Found existing reaction starters",
        );
        return { starters, isNew: false };
      }

      // No existing starters - save this user as a new starter
      await this.repository.saveStarter(
        messageId,
        emojiId,
        emojiName,
        userId,
        guildId,
      );

      this.logger.trace(
        { messageId, emojiId, emojiName, userId },
        "New reaction starter created",
      );
      return { starters: [userId], isNew: true };
    } catch (err) {
      this.logger.error(
        { err, messageId, emojiId, emojiName, userId, guildId },
        "Failed to get or set reaction starter",
      );
      // Fallback: treat as existing reaction with current user as starter
      // This prevents the reaction from being lost entirely
      return { starters: [userId], isNew: false };
    }
  }
}
