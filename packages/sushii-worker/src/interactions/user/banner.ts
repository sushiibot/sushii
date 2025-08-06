import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
} from "discord.js";

import Color from "../../utils/colors";
import { SlashCommandHandler } from "../handlers";
import { getUserString } from "../../utils/userString";

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
    const target =
      interaction.options.getUser("user", false) || interaction.user;

    // TODO: Member banners in Discord.js v15
    // https://github.com/discordjs/discord.js/pull/10384

    const userBannerURL = target.bannerURL({
      size: 4096,
    });

    if (!userBannerURL) {
      const embed = new EmbedBuilder()
        .setColor(Color.Error)
        .setDescription(`${target.toString()} doesn't have a banner set.`);

      await interaction.reply({
        embeds: [embed],
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(getUserString(target))
      .setURL(userBannerURL)
      .setImage(userBannerURL)
      .setColor(Color.Success)
      .toJSON();

    await interaction.reply({
      embeds: [embed],
    });
  }
}
