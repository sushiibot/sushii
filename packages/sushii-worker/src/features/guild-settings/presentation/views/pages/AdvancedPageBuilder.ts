import type { CacheType, ContainerBuilder, Interaction} from "discord.js";
import { TextDisplayBuilder } from "discord.js";

import type { SettingsMessageOptions } from "../components/SettingsConstants";

export function addAdvancedContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
  _interaction?: Interaction<CacheType>,
): void {
  const { config } = options;

  // Header
  const headerText = new TextDisplayBuilder().setContent(
    "## Advanced Settings",
  );
  container.addTextDisplayComponents(headerText);

  // Legacy Settings
  let advancedContent = "**Old Command Prefix** (rarely needed)\n";
  advancedContent += `**Prefix:** \`${config.prefix || "None set"}\`\n`;
  advancedContent +=
    "╰ Only needed if you have very old custom commands. Most servers can ignore this.\n\n";

  const advancedText = new TextDisplayBuilder().setContent(advancedContent);
  container.addTextDisplayComponents(advancedText);
}
