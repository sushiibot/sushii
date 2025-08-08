import type {
  ChatInputCommandInteraction} from "discord.js";
import {
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";
import { getErrorMessage } from "@/interactions/responses/error";

import type { GetUserRankService } from "../../application/GetUserRankService";
import { formatRankCard } from "../views/RankDisplayView";

export default class RankCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("rank")
    .setDescription("View your or another user's rank.")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Whose rank to view.")
        .setRequired(false),
    )
    .toJSON();

  constructor(
    private readonly getUserRankUseCase: GetUserRankService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild missing");
    }

    const target = interaction.options.getUser("user") || interaction.user;

    const result = await this.getUserRankUseCase.execute(
      target,
      interaction.guildId,
    );

    if (result.err) {
      this.logger.error({ err: result.val }, "Failed to get user rank");

      const msg = getErrorMessage("Failed to get user rank", result.val);
      await interaction.reply(msg);

      return;
    }

    // Target avatar
    const avatarURL = target.displayAvatarURL({
      size: 512,
    });

    const msg = formatRankCard(result.safeUnwrap(), avatarURL);

    await interaction.reply(msg);
  }
}
