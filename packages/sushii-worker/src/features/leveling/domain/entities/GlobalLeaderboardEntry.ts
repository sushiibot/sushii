import { RankPosition } from "../value-objects/RankPosition";
import { XpAmount } from "../value-objects/XpAmount";

export class GlobalLeaderboardEntry {
  constructor(
    private readonly userId: string,
    private readonly rank: RankPosition,
    private readonly allTimeXp: XpAmount,
    private readonly anonymous: boolean,
  ) {}

  getUserId(): string {
    return this.userId;
  }

  getRank(): RankPosition {
    return this.rank;
  }

  getAllTimeXp(): XpAmount {
    return this.allTimeXp;
  }

  isAnonymous(): boolean {
    return this.anonymous;
  }

  static create(
    userId: string,
    rank: number,
    allTimeXp: bigint,
    anonymous: boolean,
  ): GlobalLeaderboardEntry {
    return new GlobalLeaderboardEntry(
      userId,
      RankPosition.create(rank, 0), // totalCount not needed on page entries
      XpAmount.from(allTimeXp),
      anonymous,
    );
  }
}
