import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
import { TextDisplayBuilder } from "discord.js";

import { addToggleSetting } from "../components/SettingsComponents";
import type { SettingsMessageOptions } from "../components/SettingsConstants";
import { SETTINGS_CUSTOM_IDS } from "../components/SettingsConstants";

export function addLookupContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
  _interaction?: Interaction<CacheType>,
): void {
  const { config, disabled = false, emojis } = options;

  // Page header
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${emojis.lookup} Lookup`,
    ),
  );

  // Explanation
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "### Lookup Data Sharing\n" +
        "When using `/lookup` to check user bans:\n" +
        "- **Share Details**: See other servers' names and ban reasons (recommended for better moderation)\n" +
        "- **Keep Private**: Only see ban dates (no server names or reasons)\n" +
        "-# To see details from other servers, you must also share yours.",
    ),
  );

  addToggleSetting(
    container,
    `${emojis.lookup} Lookup Data Sharing`,
    config.moderationSettings.lookupDetailsOptIn
      ? "Sharing server name and ban reasons with other servers"
      : "Keeping server name and ban reasons private",
    config.moderationSettings.lookupDetailsOptIn,
    SETTINGS_CUSTOM_IDS.TOGGLES.LOOKUP_OPT_IN,
    disabled,
  );
}
