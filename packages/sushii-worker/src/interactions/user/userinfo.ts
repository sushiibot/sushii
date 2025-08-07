import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

import logger from "@/shared/infrastructure/logger";

import { SlashCommandHandler } from "../handlers";
import getUserinfoEmbed from "./userinfo.service";

export default class UserinfoHandler extends SlashCommandHandler {
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

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    let target = interaction.options.getUser("user");

    if (!target) {
      target = interaction.user;
    }

    let member;
    try {
      if (interaction.inCachedGuild()) {
        member = await interaction.guild.members.fetch(target.id);
      }
    } catch {
      // Ignore
    }

    if (!target) {
      throw new Error("No target set, should be unreachable");
    }

    const embed = await getUserinfoEmbed(target, member);
    logger.debug("userinfo embed: %o", embed);

    await interaction.reply({
      embeds: [embed],
    });
  }
}
