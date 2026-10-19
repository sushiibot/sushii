import { XpAmount } from "../value-objects/XpAmount";
import { BaseUserLevel } from "./BaseUserLevel";

export class UserLevel extends BaseUserLevel {
  constructor(
    userId: string,
    private readonly guildId: string,
    xpAllTime: number,
    private xpMonth: number,
    private xpWeek: number,
    private xpDay: number,
    private lastMessageTime: Date,
  ) {
    super(userId, XpAmount.from(xpAllTime));
  }

  getGuildId(): string {
    return this.guildId;
  }

  getAllTimeXp(): number {
    return this.totalXp.getNumericValue();
  }

  getMonthXp(): number {
    return this.xpMonth;
  }

  getWeekXp(): number {
    return this.xpWeek;
  }

  getDayXp(): number {
    return this.xpDay;
  }

  getLastMessageTime(): Date {
    return this.lastMessageTime;
  }

  canGainXp(currentTime: Date = new Date()): boolean {
    const oneMinuteAgo = new Date(currentTime.getTime() - 60000);
    return this.lastMessageTime < oneMinuteAgo;
  }

  /**
   * Adds XP if the user is off cooldown. Returns the level *before* adding XP;
   * getCurrentLevel() reflects the updated XP afterwards.
   */
  addXp(amount: number, currentTime: Date): number {
    if (!this.canGainXp(currentTime)) {
      return this.getCurrentLevel();
    }

    const oldLevel = this.getCurrentLevel();

    this.totalXp = this.totalXp.add(XpAmount.from(amount));
    this.resetTimeframeXpIfNeeded(amount, currentTime);
    this.lastMessageTime = currentTime;

    return oldLevel;
  }

  private resetTimeframeXpIfNeeded(amount: number, currentTime: Date): void {
    if (this.shouldResetDay(currentTime)) {
      this.xpDay = amount;
    } else {
      this.xpDay += amount;
    }

    if (this.shouldResetWeek(currentTime)) {
      this.xpWeek = amount;
    } else {
      this.xpWeek += amount;
    }

    if (this.shouldResetMonth(currentTime)) {
      this.xpMonth = amount;
    } else {
      this.xpMonth += amount;
    }
  }

  // All timeframe boundaries are UTC, matching the repository SQL filters.
  private shouldResetDay(currentTime: Date): boolean {
    return (
      this.lastMessageTime.getUTCDate() !== currentTime.getUTCDate() ||
      this.lastMessageTime.getUTCMonth() !== currentTime.getUTCMonth() ||
      this.lastMessageTime.getUTCFullYear() !== currentTime.getUTCFullYear()
    );
  }

  private shouldResetWeek(currentTime: Date): boolean {
    const lastWeek = this.getWeek(this.lastMessageTime);
    const currentWeek = this.getWeek(currentTime);

    return (
      lastWeek.week !== currentWeek.week || lastWeek.year !== currentWeek.year
    );
  }

  private shouldResetMonth(currentTime: Date): boolean {
    return (
      this.lastMessageTime.getUTCMonth() !== currentTime.getUTCMonth() ||
      this.lastMessageTime.getUTCFullYear() !== currentTime.getUTCFullYear()
    );
  }

  // ISO 8601 week number and ISO week-numbering year (UTC)
  private getWeek(date: Date): { week: number; year: number } {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );

    return { week: weekNo, year: d.getUTCFullYear() };
  }

  static create(
    userId: string,
    guildId: string,
    initialXp: number = 5,
    currentTime: Date = new Date(),
  ): UserLevel {
    return new UserLevel(
      userId,
      guildId,
      initialXp,
      initialXp,
      initialXp,
      initialXp,
      currentTime,
    );
  }

  static fromData(data: {
    userId: string;
    guildId: string;
    msgAllTime: bigint | number;
    msgMonth: bigint | number;
    msgWeek: bigint | number;
    msgDay: bigint | number;
    lastMsg: Date;
  }): UserLevel {
    return new UserLevel(
      data.userId,
      data.guildId,
      Number(data.msgAllTime),
      Number(data.msgMonth),
      Number(data.msgWeek),
      Number(data.msgDay),
      data.lastMsg,
    );
  }
}
