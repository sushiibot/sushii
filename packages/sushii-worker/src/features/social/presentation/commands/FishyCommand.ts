import { isDayjs } from "dayjs";
import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { FishyService } from "../../application";
import { createFishyCooldownEmbed, createFishySuccessEmbed } from "../views";

export class FishyCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("fishy")
    .setDescription("Catch some fish!")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Who to fishy for or yourself if you have no friends")
        .setRequired(true),
    )
    .toJSON();

  constructor(private readonly fishyService: FishyService) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const target = interaction.options.getUser("user", true);

    try {
      const result = await this.fishyService.fishyForUser(
        interaction.user,
        target,
      );

      let embed;
      if (isDayjs(result)) {
        embed = createFishyCooldownEmbed(result);
      } else {
        embed = createFishySuccessEmbed(result, target.username);
      }

      await interaction.reply({
        embeds: [embed.toJSON()],
      });
    } catch (error) {
      // Log error for debugging
      console.error("Fishy command error:", error);

      await interaction.reply({
        content: "Something went wrong while fishing! Please try again later.",
        ephemeral: true,
      });
    }
  }
}
