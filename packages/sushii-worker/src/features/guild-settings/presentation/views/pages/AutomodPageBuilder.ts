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

export function addAutomodContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
  _interaction?: Interaction<CacheType>,
): void {
  const { config, disabled = false } = options;

  // Header
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Automod"),
  );

  // Intro text
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "### Spam Detection\nTimes out users who send identical messages to 3+ channels within 5 seconds. Useful for catching hacked accounts spreading spam or malicious links.",
    ),
  );

  // Spam Detection Toggle Section
  container.addSectionComponents(
    createToggleSection(
      "Spam Detection",
      "Automatically times out users who spam identical messages across channels",
      config.moderationSettings.automodSpamEnabled,
      SETTINGS_CUSTOM_IDS.TOGGLES.AUTOMOD_SPAM,
      disabled,
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "-# Timeouts will be tracked in your mod log channel if one is configured.",
    ),
  );
}
