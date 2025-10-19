export class Notification {
  private constructor(
    public readonly guildId: string,
    public readonly userId: string,
    public readonly keyword: string,
    skipValidation: boolean = false,
  ) {
    if (!skipValidation) {
      this.validateKeyword(keyword);
    }
  }

  private validateKeyword(keyword: string): void {
    const cleaned = keyword.toLowerCase().trim();

    if (cleaned.length < 2) {
      throw new Error("Keyword must be at least 2 characters long");
    }

    if (cleaned.length > 100) {
      throw new Error("Keyword must be no more than 100 characters long");
    }
  }

  get cleanedKeyword(): string {
    return this.keyword.toLowerCase().trim();
  }

  static create(
    guildId: string,
    userId: string,
    keyword: string,
  ): Notification {
    return new Notification(guildId, userId, keyword, false);
  }

  static fromDatabase(
    guildId: string,
    userId: string,
    keyword: string,
  ): Notification {
    return new Notification(guildId, userId, keyword, true);
  }
}
