import type { ChatInputCommandInteraction } from "discord.js";
import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { RepLeaderboardService } from "../../application/RepLeaderboardService";
import type { SocialLeaderboardData } from "../../domain/repositories/SocialLeaderboardRepository";
import { buildSocialLeaderboardContainer } from "../views/SocialLeaderboardView";

export class RepLeaderboardCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("rep-leaderboard")
    .setDescription("Show the reputation leaderboard for this server")
    .setContexts(InteractionContextType.Guild)
    .toJSON();

  constructor(
    private readonly getRepLeaderboardService: RepLeaderboardService,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const paginator = new ComponentsV2Paginator<SocialLeaderboardData>({
      interaction,
      pageSize: 15,
      callbacks: {
        fetchPage: async (pageIndex, pageSize) => {
          return [
            await this.getRepLeaderboardService.getRepLeaderboard(
              interaction.guildId,
              interaction.user.id,
              pageIndex,
              pageSize,
            ),
          ];
        },

        getTotalCount: async () => {
          const data = await this.getRepLeaderboardService.getRepLeaderboard(
            interaction.guildId,
            interaction.user.id,
            0,
            1,
          );
          return data.totalCount;
        },

        renderContainer: (data, state, navButtons) => {
          const leaderboardData = data[0];
          return buildSocialLeaderboardContainer(
            leaderboardData,
            "rep",
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
