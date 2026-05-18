import type { ChatInputCommandInteraction } from "discord.js";
import {
  ApplicationIntegrationType,
  ContainerBuilder,
  InteractionContextType,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";

import type { UserProfileRepository } from "../../domain/repositories/UserProfileRepository";

export default class LeaderboardPrivacyCommand extends SlashCommandHandler {
  constructor(
    private readonly userProfileRepository: UserProfileRepository,
    private readonly logger: Logger,
  ) {
    super();
  }

  command = new SlashCommandBuilder()
    .setName("leaderboard-privacy")
    .setDescription(
      "Set whether you appear as Anonymous on the global leaderboard.",
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .addBooleanOption((o) =>
      o
        .setName("anonymous")
        .setDescription(
          "If true, your name is hidden as Anonymous on /global-leaderboard.",
        )
        .setRequired(true),
    )
    .toJSON();

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const anonymous = interaction.options.getBoolean("anonymous", true);

    await interaction.deferReply({ flags: ["Ephemeral"] });

    try {
      await this.userProfileRepository.setGlobalLeaderboardAnonymous(
        interaction.user.id,
        anonymous,
      );

      const statusText = anonymous
        ? "You will now appear as **Anonymous** on the global leaderboard."
        : "You will now appear with your username on the global leaderboard.";

      const container = new ContainerBuilder()
        .setAccentColor(Color.Success)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### Global Leaderboard Privacy\n${statusText}`,
          ),
        );

      await interaction.editReply({
        components: [container],
        flags: ["IsComponentsV2"],
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: interaction.user.id },
        "Failed to update leaderboard privacy setting",
      );

      const errorContainer = new ContainerBuilder()
        .setAccentColor(Color.Error)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "Failed to update your leaderboard privacy setting. Please try again later.",
          ),
        );

      await interaction.editReply({
        components: [errorContainer],
        flags: ["IsComponentsV2"],
      });
    }
  }
}
