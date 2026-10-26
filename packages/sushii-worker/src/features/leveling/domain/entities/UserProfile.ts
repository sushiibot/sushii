export class UserProfile {
  constructor(
    private readonly userId: string,
    private readonly reputation: number,
    private readonly fishies: number,
    private readonly isPatron: boolean,
    private readonly fishyDaysTotal: number,
    private readonly patronEmojiUrl?: string,
  ) {
    if (reputation < 0) {
      throw new Error("Reputation cannot be negative");
    }
    if (fishies < 0) {
      throw new Error("Fishies cannot be negative");
    }
  }

  getUserId(): string {
    return this.userId;
  }

  getReputation(): number {
    return this.reputation;
  }

  getFishies(): number {
    return this.fishies;
  }

  getFishyDaysTotal(): number {
    return this.fishyDaysTotal;
  }

  isPatronUser(): boolean {
    return this.isPatron;
  }

  getPatronEmojiUrl(): string {
    return (
      this.patronEmojiUrl ??
      "https://cdn.discordapp.com/emojis/830976556976963644.png"
    );
  }

  getReputationLevel(): number {
    if (this.reputation >= 2000) return 11;
    if (this.reputation >= 1000) return 10;
    if (this.reputation >= 100) return 9;
    if (this.reputation >= 50) return 8;
    return 7;
  }

  getReputationLevelDisplay(): string {
    return this.getReputationLevel().toString().padStart(2, "0");
  }

  static create(
    userId: string,
    profileData: {
      rep: string | number;
      fishies: string | number;
      isPatron: boolean;
      fishyDaysTotal?: number;
      profileData?: { patronEmojiURL?: string } | null;
    },
  ): UserProfile {
    const reputation =
      typeof profileData.rep === "string"
        ? parseInt(profileData.rep, 10)
        : profileData.rep;

    const fishies =
      typeof profileData.fishies === "string"
        ? parseInt(profileData.fishies, 10)
        : profileData.fishies;

    let patronEmojiUrl: string | undefined;
    if (
      profileData.profileData &&
      typeof profileData.profileData === "object" &&
      !Array.isArray(profileData.profileData) &&
      typeof profileData.profileData.patronEmojiURL === "string"
    ) {
      patronEmojiUrl = profileData.profileData.patronEmojiURL;
    }

    return new UserProfile(
      userId,
      reputation,
      fishies,
      profileData.isPatron,
      profileData.fishyDaysTotal ?? 0,
      patronEmojiUrl,
    );
  }
}
