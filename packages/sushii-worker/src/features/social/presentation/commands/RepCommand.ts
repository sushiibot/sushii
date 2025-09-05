import { isDayjs } from "dayjs";
import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { ReputationService } from "../../application";
import { createRepCooldownMessage, createRepSuccessMessage } from "../views";

export class RepCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("rep")
    .setDescription("Give someone some reputation")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Who to give reputation to.")
        .setRequired(true),
    )
    .toJSON();

  constructor(private readonly reputationService: ReputationService) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const target = interaction.options.getUser("user", true);

    try {
      const result = await this.reputationService.repForUser(
        interaction.user,
        target,
      );

      if (isDayjs(result)) {
        const message = createRepCooldownMessage(result);
        await interaction.reply(message);
      } else {
        const message = createRepSuccessMessage(result, target.id);
        await interaction.reply(message);
      }
    } catch (error) {
      // Handle self-rep error
      if (error instanceof Error && error.message.includes("yourself")) {
        await interaction.reply({
          content: "You cannot give reputation to yourself!",
          ephemeral: true,
        });
      } else {
        throw error;
      }
    }
  }
}
