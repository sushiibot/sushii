import type { ContainerBuilder} from "discord.js";
import { TextDisplayBuilder } from "discord.js";

import type { SettingsMessageOptions } from "../components/SettingsConstants";

export function addAdvancedContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
): void {
  const { config } = options;

  // Header
  const headerText = new TextDisplayBuilder().setContent(
    "## Advanced Settings",
  );
  container.addTextDisplayComponents(headerText);

  // Legacy Settings
  let advancedContent = "**Legacy Settings**\n";
  advancedContent += `**Prefix:** \`${config.prefix || "None set"}\`\n`;
  advancedContent +=
    "╰ Only used for legacy commands not yet migrated to slash commands\n\n";

  const advancedText = new TextDisplayBuilder().setContent(advancedContent);
  container.addTextDisplayComponents(advancedText);
}
