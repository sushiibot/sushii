import { RankPosition } from "../value-objects/RankPosition";
import { XpAmount } from "../value-objects/XpAmount";

export class LeaderboardEntry {
  constructor(
    private readonly userId: string,
    private readonly rank: RankPosition,
    private readonly allTimeXp: XpAmount,
    private readonly dayXp: XpAmount,
    private readonly weekXp: XpAmount,
    private readonly monthXp: XpAmount,
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

  getDayXp(): XpAmount {
    return this.dayXp;
  }

  getWeekXp(): XpAmount {
    return this.weekXp;
  }

  getMonthXp(): XpAmount {
    return this.monthXp;
  }

  static create(
    userId: string,
    rank: number,
    allTimeXp: bigint,
    dayXp: bigint,
    weekXp: bigint,
    monthXp: bigint,
  ): LeaderboardEntry {
    return new LeaderboardEntry(
      userId,
      RankPosition.create(rank, 0), // totalCount will be set by the service
      XpAmount.from(allTimeXp),
      XpAmount.from(dayXp),
      XpAmount.from(weekXp),
      XpAmount.from(monthXp),
    );
  }
}
