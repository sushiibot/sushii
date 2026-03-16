import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
import {
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import {
  createToggleSection,
} from "../components/SettingsComponents";
import type { SettingsMessageOptions } from "../components/SettingsConstants";
import { SETTINGS_CUSTOM_IDS } from "../components/SettingsConstants";

export function addModerationContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
  _interaction?: Interaction<CacheType>,
): void {
  const { config, disabled = false } = options;

  // Page header
  const headerText = new TextDisplayBuilder().setContent("## Moderation");
  container.addTextDisplayComponents(headerText);

  // Lookup Settings Section
  const lookupIntro = new TextDisplayBuilder().setContent(
    "### Lookup Settings\n" +
    "When using `/lookup` to check user bans:\n" +
    "- **Share Details**: See other servers' names and ban reasons (recommended for better moderation)\n" +
    "- **Keep Private**: Only see ban dates (no server names or reasons)\n" +
    "-# To see details from other servers, you must also share yours.",
  );
  container.addTextDisplayComponents(lookupIntro);

  container.addSectionComponents(
    createToggleSection(
      "Lookup Data Sharing",
      config.moderationSettings.lookupDetailsOptIn
        ? "Sharing server name and ban reasons with other servers"
        : "Keeping server name and ban reasons private",
      config.moderationSettings.lookupDetailsOptIn,
      SETTINGS_CUSTOM_IDS.TOGGLES.LOOKUP_OPT_IN,
      disabled,
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // DM Settings Section
  const dmIntro = new TextDisplayBuilder().setContent(
    "### Default DM Settings\n" +
    "Choose when the bot sends DMs to users for moderation actions.\n" +
    "-# You can override these per command using the `dm_reason` option.",
  );
  container.addTextDisplayComponents(dmIntro);

  // Timeout Command DM
  container.addSectionComponents(
    createToggleSection(
      "DM on /timeout command",
      "When you use the `/timeout` command, send them a DM with the reason",
      config.moderationSettings.timeoutCommandDmEnabled,
      SETTINGS_CUSTOM_IDS.TOGGLES.TIMEOUT_COMMAND_DM,
      disabled,
    ),
  );

  // Timeout Native DM
  container.addSectionComponents(
    createToggleSection(
      "DM on Discord Timeout",
      "When you right-click a user → Timeout, send them a DM with the reason",
      config.moderationSettings.timeoutNativeDmEnabled,
      SETTINGS_CUSTOM_IDS.TOGGLES.TIMEOUT_NATIVE_DM,
      disabled,
    ),
  );

  // Ban DM
  container.addSectionComponents(
    createToggleSection(
      "Ban DM",
      "Always DM the user when banned. Only works with `/ban` command — right-click bans cannot send DMs.",
      config.moderationSettings.banDmEnabled,
      SETTINGS_CUSTOM_IDS.TOGGLES.BAN_DM,
      disabled,
    ),
  );

  // Kick DM
  container.addSectionComponents(
    createToggleSection(
      "Kick DM",
      "Always DM the user when kicked.",
      config.moderationSettings.kickDmEnabled,
      SETTINGS_CUSTOM_IDS.TOGGLES.KICK_DM,
      disabled,
    ),
  );
}
