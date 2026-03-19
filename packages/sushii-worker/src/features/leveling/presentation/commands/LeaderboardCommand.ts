import type { ChatInputCommandInteraction } from "discord.js";
import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { GetLeaderboardService } from "../../application/GetLeaderboardService";
import type { LeaderboardData } from "../../application/GetLeaderboardService";
import {
  TimeFrame,
  isValidTimeFrame,
} from "../../domain/value-objects/TimeFrame";
import { buildLeaderboardContainer } from "../views/LeaderboardDisplayView";

export default class LeaderboardCommand extends SlashCommandHandler {
  constructor(private readonly getLeaderboardService: GetLeaderboardService) {
    super();
  }

  command = new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the leaderboard for the server.")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName("timeframe")
        .setDescription("The timeframe for the leaderboard.")
        .setRequired(false)
        .addChoices(
          {
            name: "Day",
            value: TimeFrame.DAY,
          },
          {
            name: "Week",
            value: TimeFrame.WEEK,
          },
          {
            name: "Month",
            value: TimeFrame.MONTH,
          },
          {
            name: "All Time",
            value: TimeFrame.ALL_TIME,
          },
        ),
    )
    .toJSON();

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const timeframeRaw =
      interaction.options.getString("timeframe") ?? TimeFrame.ALL_TIME;

    if (!isValidTimeFrame(timeframeRaw)) {
      throw new Error("Invalid timeframe");
    }
    const timeframe = timeframeRaw as TimeFrame;

    // Cache totalCount from fetchPage to avoid a redundant DB call in getTotalCount
    let cachedTotalCount: number | undefined;

    const paginator = new ComponentsV2Paginator<LeaderboardData>({
      interaction,
      pageSize: 10,
      callbacks: {
        fetchPage: async (pageIndex, pageSize) => {
          const data = await this.getLeaderboardService.getLeaderboard(
            interaction.guildId,
            interaction.user.id,
            timeframe,
            pageIndex,
            pageSize,
          );
          cachedTotalCount = data.totalCount;
          return [data];
        },

        getTotalCount: async () => {
          if (cachedTotalCount !== undefined) {
            return cachedTotalCount;
          }
          const data = await this.getLeaderboardService.getLeaderboard(
            interaction.guildId,
            interaction.user.id,
            timeframe,
            0,
            1,
          );
          cachedTotalCount = data.totalCount;
          return cachedTotalCount;
        },

        renderContainer: (data, state, navButtons) => {
          if (!data[0]) {
            throw new Error("No leaderboard data returned");
          }
          return buildLeaderboardContainer(
            data[0],
            timeframe,
            interaction.user.id,
            navButtons,
            state.isDisabled,
          );
        },
      },
    });

    await paginator.start(false);
  }
}
