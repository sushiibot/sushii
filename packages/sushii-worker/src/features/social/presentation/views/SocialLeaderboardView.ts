import type { ActionRowBuilder, ButtonBuilder } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "discord.js";

import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import Color from "@/utils/colors";

import type { SocialLeaderboardData } from "../../domain/repositories/SocialLeaderboardRepository";

export function formatSocialLeaderboard(
  data: SocialLeaderboardData,
  type: "rep" | "fishies",
  requestingUserId: string,
): string {
  let description = "";

  // Check if user is in the current page
  let userInTopList = false;
  for (const entry of data.entries) {
    const formattedAmount = Number(entry.getAmount()).toLocaleString();
    const suffix = type === "rep" ? "rep" : "fishies";

    description += `${entry.getRank()}. <@${entry.getUserId()}> • ${formattedAmount} ${suffix}\n`;

    if (entry.getUserId() === requestingUserId) {
      userInTopList = true;
    }
  }

  // Add user's rank if they're not in the top list and we have their data
  if (!userInTopList && data.userRank && data.userAmount && requestingUserId) {
    const formattedUserAmount = Number(data.userAmount).toLocaleString();
    const suffix = type === "rep" ? "rep" : "fishies";

    description += "---\n";
    description += `${data.userRank}. <@${requestingUserId}> • ${formattedUserAmount} ${suffix}\n`;
  }

  return description;
}

export function buildSocialLeaderboardContainer(
  data: SocialLeaderboardData,
  type: "rep" | "fishies",
  requestingUserId: string,
  navButtons: ActionRowBuilder<ButtonBuilder> | null,
  isDisabled: boolean,
): ContainerBuilder {
  const container = new ContainerBuilder();

  const title = type === "rep" ? "Rep Leaderboard" : "Fishy Leaderboard";
  container.setAccentColor(Color.Info);

  const description = formatSocialLeaderboard(data, type, requestingUserId);

  if (description.trim()) {
    const content = `### ${title}\n${description}`;
    const textDisplay = new TextDisplayBuilder().setContent(content);
    container.addTextDisplayComponents(textDisplay);
  } else {
    const noDataMessage = type === "rep"
      ? "No one in this server has any rep yet! Use `/rep @user` to give someone rep."
      : "No one in this server has any fishies yet! Use `/fishy @user` to catch some fish.";
    const textDisplay = new TextDisplayBuilder().setContent(`### ${title}\n${noDataMessage}`);
    container.addTextDisplayComponents(textDisplay);
  }

  // Add navigation section
  ComponentsV2Paginator.addNavigationSection(container, navButtons, isDisabled);

  return container;
}