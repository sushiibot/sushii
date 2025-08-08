import type {
  ChatInputCommandInteraction,
  Client} from "discord.js";
import {
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";

import { createBannerEmbeds } from "../views/BannerView";

export class BannerCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("banner")
    .setDescription("View someone's banner.")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Who to get the banner of, your own if not provided."),
    )
    .toJSON();

  constructor(
    private readonly client: Client,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const targetUser =
      interaction.options.getUser("user", false) || interaction.user;

    try {
      // Refetch via user ID to get the banner
      const user = await this.client.users.fetch(targetUser.id);

      let member;
      if (interaction.guildId) {
        try {
          const guild = await this.client.guilds.fetch(interaction.guildId);
          member = await guild.members.fetch(user.id);
        } catch {
          // Member not in guild, continue without member info
        }
      }

      const result = createBannerEmbeds(user, member || undefined);

      if (!result.success) {
        await interaction.reply({
          embeds: [result.errorEmbed],
        });
        return;
      }

      await interaction.reply({
        embeds: result.embeds,
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: targetUser.id, guildId: interaction.guildId },
        "Failed to get user banner",
      );

      throw new Error("Failed to fetch user banner");
    }
  }
}