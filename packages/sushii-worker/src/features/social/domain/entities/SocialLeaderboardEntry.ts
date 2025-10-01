export class SocialLeaderboardEntry {
  constructor(
    private readonly userId: string,
    private readonly rank: number,
    private readonly amount: bigint,
  ) {}

  getUserId(): string {
    return this.userId;
  }

  getRank(): number {
    return this.rank;
  }

  getAmount(): bigint {
    return this.amount;
  }

  static create(userId: string, rank: number, amount: bigint): SocialLeaderboardEntry {
    return new SocialLeaderboardEntry(userId, rank, amount);
  }
}