export class ReactionStarter {
  constructor(
    public readonly messageId: string,
    public readonly emojiId: string, // ID for custom emojis, unicode string for native emojis
    public readonly emojiName: string | null, // Name for custom emojis only, null for native emojis
    public readonly userIds: string[], // Array of user IDs who started this reaction (ordered chronologically)
    public readonly guildId: string,
    public readonly createdAt?: Date, // When the first starter was created
  ) {}

  /**
   * Get the display string for an emoji (what users see)
   * For custom emojis: <:name:id> or <a:name:id> for animated
   * For native emojis: the unicode character
   */
  getDisplayString(isAnimated = false): string {
    if (this.emojiName) {
      // Custom emoji
      const prefix = isAnimated ? "<a:" : "<:";
      return `${prefix}${this.emojiName}:${this.emojiId}>`;
    }

    // Native emoji - emojiId IS the display string
    return this.emojiId;
  }

  /**
   * Check if this is a custom emoji (has an ID that's not the display string)
   */
  isCustomEmoji(): boolean {
    return this.emojiName !== null;
  }

  /**
   * Get the first starter (who originally started the reaction)
   */
  getFirstStarter(): string | undefined {
    return this.userIds[0];
  }

  /**
   * Get re-starters (users who added the reaction after it was removed)
   */
  getReStarters(): string[] {
    return this.userIds.slice(1);
  }

  /**
   * Check if a specific user started this reaction
   */
  hasStarter(userId: string): boolean {
    return this.userIds.includes(userId);
  }

  /**
   * Get the total number of starters
   */
  getStarterCount(): number {
    return this.userIds.length;
  }

  /**
   * Create a new ReactionStarter with an additional user
   */
  withAdditionalStarter(userId: string): ReactionStarter {
    if (this.userIds.includes(userId)) {
      return this; // User already exists, return unchanged
    }

    return new ReactionStarter(
      this.messageId,
      this.emojiId,
      this.emojiName,
      [...this.userIds, userId],
      this.guildId,
      this.createdAt,
    );
  }

  /**
   * Static factory method to create from database row
   */
  static fromDatabaseRow(
    messageId: string,
    emojiId: string,
    emojiName: string | null,
    userId: string,
    guildId: string,
    createdAt: Date,
  ): ReactionStarter {
    return new ReactionStarter(
      messageId,
      emojiId,
      emojiName,
      [userId],
      guildId,
      createdAt,
    );
  }
}
