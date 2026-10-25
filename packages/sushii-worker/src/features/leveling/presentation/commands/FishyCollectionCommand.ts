import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import {
  type UserOverviewDependencies,
  UserOverviewSession,
} from "../UserOverviewSession";

export class FishyCollectionCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("fishy-collection")
    .setDescription("Browse your or another user's fishy discoveries.")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option.setName("user").setDescription("Whose fishy collection to view."),
    )
    .toJSON();
  constructor(private readonly dependencies: UserOverviewDependencies) {
    super();
  }
  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) throw new Error("Guild missing");
    await new UserOverviewSession(
      interaction,
      interaction.options.getUser("user") ?? interaction.user,
      this.dependencies,
      "collection",
    ).start();
  }
}
