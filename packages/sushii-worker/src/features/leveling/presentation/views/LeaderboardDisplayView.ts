import type { LeaderboardData } from "../../application/GetLeaderboardService";
import type { UserRank } from "../../domain/entities/UserRank";
import {
  calculateLevel,
  calculateLevelProgress,
} from "@/shared/domain/utils/LevelCalculations";
import { ProgressBar } from "../../domain/value-objects/ProgressBar";
import { TimeFrame } from "../../domain/value-objects/TimeFrame";

export function formatLeaderboardPage(
  data: LeaderboardData,
  timeframe: TimeFrame,
  requestingUserId?: string,
): string {
  let description = "";

  // Check if user is in the current page
  let userInTopList = false;
  for (const entry of data.entries) {
    const level = calculateLevel(BigInt(entry.getAllTimeXp().getValue()));
    const levelProgress = calculateLevelProgress(
      BigInt(entry.getAllTimeXp().getValue()),
    );
    const progressBar = ProgressBar.fromProgress(
      levelProgress.nextLevelXpProgress,
      levelProgress.nextLevelXpRequired,
    );

    description += `${entry.getRank().getRank()}. **Level ${level}** • <@${entry.getUserId()}>\n`;
    description += `${progressBar.render()}\n`;
    description += `-# ${levelProgress.nextLevelXpProgress} / ${levelProgress.nextLevelXpRequired} XP\n\n`;

    if (entry.getUserId() === requestingUserId) {
      userInTopList = true;
    }
  }

  // Add user's rank if they're not in the top list and we have their data
  if (!userInTopList && data.userRank && data.userLevel && requestingUserId) {
    const userLevel = calculateLevel(BigInt(data.userLevel.getAllTimeXp()));
    const userLevelProgress = calculateLevelProgress(
      BigInt(data.userLevel.getAllTimeXp()),
    );
    const userProgressBar = ProgressBar.fromProgress(
      userLevelProgress.nextLevelXpProgress,
      userLevelProgress.nextLevelXpRequired,
    );
    const rankForTimeframe = getUserRankForTimeframe(data.userRank, timeframe);

    if (rankForTimeframe) {
      description += "---\n";
      description += `${rankForTimeframe}. **Level ${userLevel}** • <@${requestingUserId}>\n`;
      description += `${userProgressBar.render()}\n`;
      description += `-# ${userLevelProgress.nextLevelXpProgress} / ${userLevelProgress.nextLevelXpRequired} XP\n`;
    }
  }

  return description;
}

function getUserRankForTimeframe(
  userRank: UserRank,
  timeframe: TimeFrame,
): number | null {
  switch (timeframe) {
    case TimeFrame.DAY:
      return userRank.getDayRank().getRank();
    case TimeFrame.WEEK:
      return userRank.getWeekRank().getRank();
    case TimeFrame.MONTH:
      return userRank.getMonthRank().getRank();
    case TimeFrame.ALL_TIME:
      return userRank.getAllTimeRank().getRank();
    default:
      return null;
  }
}
