import {
  LevelProgress,
  calculateLevel,
  calculateLevelProgress,
} from "@/shared/domain/utils/LevelCalculations";
import { ProgressBar } from "../value-objects/ProgressBar";
import { XpAmount } from "../value-objects/XpAmount";

export abstract class BaseUserLevel {
  constructor(
    protected readonly userId: string,
    protected readonly totalXp: XpAmount,
  ) {}

  getUserId(): string {
    return this.userId;
  }

  getTotalXp(): XpAmount {
    return this.totalXp;
  }

  getCurrentLevel(): number {
    return calculateLevel(this.totalXp.getValue());
  }

  getLevelProgress(): LevelProgress {
    return calculateLevelProgress(this.totalXp.getValue());
  }

  getProgressBar(): ProgressBar {
    const progress = this.getLevelProgress();
    return ProgressBar.fromPercentage(progress.nextLevelXpPercentage);
  }

  getXpDisplayText(): string {
    const progress = this.getLevelProgress();
    return `${progress.nextLevelXpProgress} / ${progress.nextLevelXpRequired} XP`;
  }
}
