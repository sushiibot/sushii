import type { ChatInputCommandInteraction, Client } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";

import { createUserInfoEmbed } from "../views/UserInfoView";

export class UserInfoCommand extends SlashCommandHandler {
  serverOnly = false;

  command = new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Get information about a user")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription(
          "The user to get information about, yourself if not provided",
        ),
    )
    .toJSON();

  constructor(
    private readonly client: Client,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    let target = interaction.options.getUser("user");

    if (!target) {
      target = interaction.user;
    }

    try {
      const user = await this.client.users.fetch(target.id);

      let member;
      if (interaction.inCachedGuild()) {
        try {
          member = await interaction.guild.members.fetch(target.id);
        } catch {
          // Member not in guild, continue without member info
        }
      }

      const embed = createUserInfoEmbed(user, member || undefined);

      this.logger.debug({ embed }, "userinfo embed");

      await interaction.reply({
        embeds: [embed],
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: target.id, guildId: interaction.guildId },
        "Failed to get user info",
      );

      throw new Error("Failed to fetch user information");
    }
  }
}
