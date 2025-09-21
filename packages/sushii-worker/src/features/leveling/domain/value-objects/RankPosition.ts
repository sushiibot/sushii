export class RankPosition {
  constructor(
    private readonly rank: number | null,
    private readonly totalCount: number,
  ) {
    if (rank !== null && rank < 1) {
      throw new Error("Rank position must be positive");
    }
    if (totalCount < 0) {
      throw new Error("Total count cannot be negative");
    }
  }

  getRank(): number | null {
    return this.rank;
  }

  getTotalCount(): number {
    return this.totalCount;
  }

  hasRank(): boolean {
    return this.rank !== null;
  }

  getDisplayRank(): string {
    return this.rank?.toLocaleString() ?? "-";
  }

  getDisplayTotal(): string {
    return this.totalCount.toLocaleString();
  }

  getFormattedPosition(): string {
    return `${this.getDisplayRank()} / ${this.getDisplayTotal()}`;
  }

  static unranked(totalCount: number): RankPosition {
    return new RankPosition(null, totalCount);
  }

  static create(rank: number, totalCount: number): RankPosition {
    return new RankPosition(rank, totalCount);
  }
}
