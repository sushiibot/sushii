import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import Color from "../../utils/colors";
import { getUserString } from "../../utils/userString";
import { SlashCommandHandler } from "../handlers";

export default class BannerCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("banner")
    .setDescription("View someone's banner.")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Who to get the banner of, your own if not provided."),
    )
    .toJSON();

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const targetUser =
      interaction.options.getUser("user", false) || interaction.user;

    // Refetch via user ID to get the banner
    const user = await interaction.client.users.fetch(targetUser.id);

    const member = await interaction.guild?.members.fetch(user.id);

    const userBannerURL = user.bannerURL({
      size: 4096,
    });

    const memberBannerURL = member?.bannerURL({
      size: 4096,
    });

    if (!userBannerURL) {
      const embed = new EmbedBuilder()
        .setColor(Color.Error)
        .setDescription(`${user.toString()} doesn't have a banner set.`);

      await interaction.reply({
        embeds: [embed],
      });

      return;
    }

    const embeds = [];

    const embed = new EmbedBuilder()
      .setTitle(getUserString(user))
      .setURL(userBannerURL)
      .setImage(userBannerURL)
      .setColor(Color.Success);

    embeds.push(embed);

    if (memberBannerURL) {
      // New embed
      const memberEmbed = new EmbedBuilder()
        .setTitle("Server Banner")
        .setURL(memberBannerURL)
        .setImage(memberBannerURL)
        .setColor(Color.Success);

      embeds.push(memberEmbed);
    }

    await interaction.reply({
      embeds,
    });
  }
}
