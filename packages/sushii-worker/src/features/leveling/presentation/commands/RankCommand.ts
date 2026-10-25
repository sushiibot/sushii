import type { ChatInputCommandInteraction } from "discord.js";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import {
  type UserOverviewDependencies,
  UserOverviewSession,
} from "../UserOverviewSession";

export default class RankCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("rank")
    .setDescription("View your or another user's rank.")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Whose rank to view.")
        .setRequired(false),
    )
    .toJSON();

  constructor(private readonly dependencies: UserOverviewDependencies) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) throw new Error("Guild missing");
    const target = interaction.options.getUser("user") ?? interaction.user;
    await new UserOverviewSession(
      interaction,
      target,
      this.dependencies,
      "rank",
    ).start();
  }
}
