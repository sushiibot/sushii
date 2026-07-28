import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { ModViewDependencies } from "@/features/moderation/mod-view/presentation/ModViewEntry";
import { openModViewOrReportError } from "@/features/moderation/mod-view/presentation/ModViewEntry";
import { getErrorMessage } from "@/interactions/responses/error";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

export class NamesCommand extends SlashCommandHandler {
  requiredBotPermissions = new PermissionsBitField();

  command = new SlashCommandBuilder()
    .setName("names")
    .setDescription("Show name history for a user.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to show name history for.")
        .setRequired(true),
    )
    .toJSON();

  constructor(
    private readonly modViewDependencies: ModViewDependencies,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not in cached guild");
    }

    const targetUser = interaction.options.getUser("user");
    if (!targetUser) {
      await interaction.reply(getErrorMessage("Error", "No user provided"));
      return;
    }

    await openModViewOrReportError(
      interaction,
      targetUser,
      this.modViewDependencies,
      "names",
    );
  }
}
