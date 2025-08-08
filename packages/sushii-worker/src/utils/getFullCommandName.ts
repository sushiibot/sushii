import type { ChatInputCommandInteraction } from "discord.js";

export default function getFullCommandName(
  interaction: ChatInputCommandInteraction,
): string {
  const subCommand = interaction.options.getSubcommand(false);
  const subCommandGroup = interaction.options.getSubcommandGroup();

  if (subCommandGroup && subCommand) {
    return `${interaction.commandName} ${subCommandGroup} ${subCommand}`;
  }

  if (subCommandGroup) {
    return `${interaction.commandName} ${subCommandGroup}`;
  }

  if (subCommand) {
    return `${interaction.commandName} ${subCommand}`;
  }

  return interaction.commandName;
}
