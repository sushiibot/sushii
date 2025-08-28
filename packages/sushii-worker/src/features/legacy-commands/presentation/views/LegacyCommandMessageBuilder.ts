import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import type { LegacyCommand } from "../../domain";
import { LEGACY_COMMAND_SUNSET_DATE } from "../../domain";

export function buildLegacyCommandDmMessage(legacyCommand: LegacyCommand) {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  // Main message content
  const content = `👋 Hey! I noticed you used \`${legacyCommand.name}\`.

This command has moved to slash commands:
• **Old:** \`${legacyCommand.name}\`
• **New:** \`${legacyCommand.replacement}\`

⏰ Text commands will stop working on **${LEGACY_COMMAND_SUNSET_DATE.toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  )}**.

📖 **Learn more about the migration:**

*(You'll receive this reminder maximum once per week)*`;

  const textDisplay = new TextDisplayBuilder().setContent(content);

  container.addTextDisplayComponents(textDisplay);

  // Add migration guide button
  const migrationButton = new ButtonBuilder()
    .setLabel("Migration Guide")
    .setStyle(ButtonStyle.Link)
    .setURL("https://sushii.bot/user-reference/slash-commands/");

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    migrationButton,
  );

  container.addActionRowComponents(buttonRow);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
