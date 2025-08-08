import {
  ChatInputCommandInteraction,
  Client,
  SlashCommandBuilder,
} from "discord.js";
import { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";

import { createAvatarEmbeds } from "../views/AvatarView";

export class AvatarCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("View someone's avatar.")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Who to get the avatar of, your own if not provided."),
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
      // Fetch full user data to get avatar
      const user = await this.client.users.fetch(targetUser.id);

      let member;
      if (interaction.inCachedGuild()) {
        try {
          member = await interaction.guild.members.fetch(user.id);
        } catch {
          // Member not in guild, continue without member info
        }
      }

      const embeds = createAvatarEmbeds(user, member || undefined);

      await interaction.reply({
        embeds,
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: targetUser.id, guildId: interaction.guildId },
        "Failed to get user avatar",
      );

      throw new Error("Failed to fetch user avatar");
    }
  }
}