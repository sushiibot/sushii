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

import type { GlobalLeaderboardData } from "../../application/GetGlobalLeaderboardService";
import { timeFrameToString } from "../../domain/value-objects/TimeFrame";
import type { TimeFrame } from "../../domain/value-objects/TimeFrame";

export function buildGlobalLeaderboardContainer(
  data: GlobalLeaderboardData,
  timeframe: TimeFrame,
  requestingUserId: string,
  navButtons: ActionRowBuilder<ButtonBuilder> | null,
  isDisabled: boolean,
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(Color.Info);
  const title = `Global Leaderboard - ${timeFrameToString(timeframe)}`;

  let userInTopList = false;
  let entriesText = "";

  for (const entry of data.entries) {
    const level = calculateLevel(entry.getTotalXp().getValue());
    const isSelf = entry.getUserId() === requestingUserId;
    const isAnonymous = entry.isAnonymous() && !isSelf;
    const userDisplay = isAnonymous ? "Anonymous" : `<@${entry.getUserId()}>`;
    entriesText += `${entry.getRank().getRank()}. **Level ${level}** • ${userDisplay}\n`;

    if (isSelf) {
      userInTopList = true;
    }
  }

  const mainText = entriesText.trim()
    ? `### ${title}\n${entriesText}`
    : `### ${title}\nNo one has earned XP yet!`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(mainText),
  );

  // Show invoking user's rank if they're not on the current page
  if (!userInTopList && data.userRank.hasRank()) {
    const userRankNumber = data.userRank.getRank();

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${userRankNumber}. <@${requestingUserId}>`,
      ),
    );
  }

  ComponentsV2Paginator.addNavigationSection(container, navButtons, isDisabled);

  return container;
}
