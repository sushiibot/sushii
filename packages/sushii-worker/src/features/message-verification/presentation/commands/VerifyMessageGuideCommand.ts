import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import { createVerificationGuideMessage } from "../views/VerificationGuideView";

export class VerifyMessageGuideCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("verify-message-guide")
    .setDescription(
      "How message verification works — what it solves and how to use it.",
    )
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .toJSON();

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply(createVerificationGuideMessage());
  }
}
