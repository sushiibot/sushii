import type { ChatInputCommandInteraction } from "discord.js";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { ModViewDependencies } from "../ModViewEntry";
import {
  openModViewOrReportError,
  respondWithModViewError,
} from "../ModViewEntry";

export class ModViewCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("modview")
    .setDescription("Show the full moderation view for a user.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("The user to show the moderation view for.")
        .setRequired(true),
    )
    .toJSON();

  constructor(private readonly deps: ModViewDependencies) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const targetUser = interaction.options.getUser("user");
    const log = this.deps.logger.child({
      guildId: interaction.guildId,
      targetId: targetUser?.id ?? null,
      executorId: interaction.user.id,
    });

    if (!targetUser) {
      log.warn("Mod view target could not be resolved");
      await respondWithModViewError(
        interaction,
        "That user could not be resolved.",
      );
      return;
    }

    await openModViewOrReportError(
      interaction,
      targetUser,
      this.deps,
      "overview",
    );
  }
}
