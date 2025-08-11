/**
 * Domain entity representing a guild ban.
 * Encapsulates the business logic for guild ban operations.
 */
export class GuildBan {
  constructor(
    public readonly guildId: string,
    public readonly userId: string,
  ) {}

  /**
   * Creates a GuildBan from raw data.
   */
  static fromData(guildId: string, userId: string): GuildBan {
    return new GuildBan(guildId, userId);
  }

  /**
   * Converts to a plain object for database operations.
   */
  toData(): { guild_id: string; user_id: string } {
    return {
      guild_id: this.guildId,
      user_id: this.userId,
    };
  }

  /**
   * Creates a unique identifier for this ban.
   */
  getId(): string {
    return `${this.guildId}:${this.userId}`;
  }
}
