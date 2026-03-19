import type { ActionRowBuilder, ButtonBuilder } from "discord.js";
import {
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import { calculateLevel } from "@/shared/domain/utils/LevelCalculations";
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import Color from "@/utils/colors";

import type { LeaderboardData } from "../../application/GetLeaderboardService";
import { TimeFrame, timeFrameToString } from "../../domain/value-objects/TimeFrame";

export function buildLeaderboardContainer(
  data: LeaderboardData,
  timeframe: TimeFrame,
  requestingUserId: string,
  navButtons: ActionRowBuilder<ButtonBuilder> | null,
  isDisabled: boolean,
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(Color.Info);
  const title = `Server Leaderboard - ${timeFrameToString(timeframe)}`;

  let userInTopList = false;
  let entriesText = "";

  for (const entry of data.entries) {
    const level = calculateLevel(BigInt(entry.getAllTimeXp().getValue()));
    entriesText += `${entry.getRank().getRank()}. **Level ${level}** • <@${entry.getUserId()}>\n`;

    if (entry.getUserId() === requestingUserId) {
      userInTopList = true;
    }
  }

  const mainText = entriesText.trim()
    ? `### ${title}\n${entriesText}`
    : `### ${title}\nNo one has earned XP yet!`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(mainText),
  );

  // Add user's own rank if they're not in the visible page
  if (!userInTopList && data.userRank && data.userLevel) {
    const userLevel = calculateLevel(BigInt(data.userLevel.getAllTimeXp()));
    const rankForTimeframe = data.userRank
      .getRankingForTimeFrame(timeframe)
      .getRank();

    if (rankForTimeframe !== null) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
      );
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${rankForTimeframe}. **Level ${userLevel}** • <@${requestingUserId}>`,
        ),
      );
    }
  }

  ComponentsV2Paginator.addNavigationSection(container, navButtons, isDisabled);

  return container;
}
