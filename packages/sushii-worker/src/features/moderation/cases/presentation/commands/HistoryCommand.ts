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
import { SlashCommandHandler } from "@/shared/presentation/handlers";

export class HistoryCommand extends SlashCommandHandler {
  requiredBotPermissions = new PermissionsBitField();

  command = new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show the moderation case history for a user.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("The user to show moderation case history for.")
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
      throw new Error("Guild not cached");
    }

    const user = interaction.options.getUser("user");
    if (!user) {
      throw new Error("No user provided");
    }

    const log = this.logger.child({
      guildId: interaction.guild.id,
      userId: user.id,
      executorId: interaction.user.id,
    });

    log.info("Processing history command");

    await openModViewOrReportError(
      interaction,
      user,
      this.modViewDependencies,
      "history",
    );
  }
}
