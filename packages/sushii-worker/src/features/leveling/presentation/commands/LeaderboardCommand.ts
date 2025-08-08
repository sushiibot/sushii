import type {
  ChatInputCommandInteraction} from "discord.js";
import {
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";

import { SlashCommandHandler } from "@/interactions/handlers";
import type {
  EmbedModifierFn,
  GetPageFn,
  GetTotalEntriesFn,
} from "@/shared/presentation/Paginator";
import Paginator from "@/shared/presentation/Paginator";

import Color from "@/utils/colors";

import type { GetLeaderboardService } from "../../application/GetLeaderboardService";
import {
  TimeFrame,
  isValidTimeFrame,
  timeFrameToString,
} from "../../domain/value-objects/TimeFrame";
import { formatLeaderboardPage } from "../views/LeaderboardDisplayView";

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

    const getPageFn: GetPageFn = async (pageIndex, pageSize) => {
      const leaderboardData = await this.getLeaderboardService.getLeaderboard(
        interaction.guildId,
        interaction.user.id,
        timeframe,
        pageIndex,
        pageSize,
      );

      return formatLeaderboardPage(
        leaderboardData,
        timeframe,
        interaction.user.id,
      );
    };

    const getTotalEntriesFn: GetTotalEntriesFn = async () => {
      const leaderboardData = await this.getLeaderboardService.getLeaderboard(
        interaction.guildId,
        interaction.user.id,
        timeframe,
        0,
        1,
      );
      return leaderboardData.totalCount;
    };

    const embedModifierFn: EmbedModifierFn = (embed) => {
      return embed
        .setTitle(`Server Leaderboard - ${timeFrameToString(timeframe)}`)
        .setColor(Color.Info);
    };

    const paginator = new Paginator({
      interaction,
      getPageFn,
      getTotalEntriesFn,
      pageSize: 10,
      embedModifierFn,
    });

    await paginator.paginate();
  }
}
