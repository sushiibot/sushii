import type { BotEmojiName } from "../BotEmojiName";

/**
 * Bot emoji entity representing a Discord application emoji.
 */
export class BotEmoji {
  constructor(
    public readonly name: BotEmojiName,
    public readonly id: string,
    public readonly sha256: string,
    public readonly createdAt: Date = new Date(),
    public readonly updatedAt: Date = new Date(),
  ) {}

  /**
   * Gets the Discord emoji string for use in messages.
   * Format: <:name:id>
   */
  get discordString(): string {
    return `<:${this.name}:${this.id}>`;
  }

  /**
   * Creates a new BotEmoji with updated hash and timestamp.
   */
  withUpdatedHash(newSha256: string): BotEmoji {
    return new BotEmoji(
      this.name,
      this.id,
      newSha256,
      this.createdAt,
      new Date(),
    );
  }

  /**
   * Creates a new BotEmoji with a new Discord ID (for replacements).
   */
  withNewId(newId: string, newSha256: string): BotEmoji {
    return new BotEmoji(
      this.name,
      newId,
      newSha256,
      this.createdAt,
      new Date(),
    );
  }
}
