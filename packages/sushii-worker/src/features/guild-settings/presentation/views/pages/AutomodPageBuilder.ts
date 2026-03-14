import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
import {
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import {
  createToggleButton,
  formatToggleSetting,
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
  const headerText = new TextDisplayBuilder().setContent("## Automod Settings");
  container.addTextDisplayComponents(headerText);

  // Intro text
  const introText = new TextDisplayBuilder().setContent(
    "### Spam Detection\nTimes out users who send identical messages to 3+ channels within 5 seconds. Useful for catching hacked accounts spreading spam or malicious links.",
  );
  container.addTextDisplayComponents(introText);

  // Spam Detection Toggle Section
  const spamDetectionContent = formatToggleSetting(
    "🛡️ Spam Detection",
    config.moderationSettings.automodSpamEnabled,
    "Automatically times out users who spam identical messages across channels",
  );

  const spamDetectionText = new TextDisplayBuilder().setContent(
    spamDetectionContent,
  );
  const spamDetectionSection = new SectionBuilder()
    .addTextDisplayComponents(spamDetectionText)
    .setButtonAccessory(
      createToggleButton(
        config.moderationSettings.automodSpamEnabled,
        SETTINGS_CUSTOM_IDS.TOGGLES.AUTOMOD_SPAM,
        disabled,
      ),
    );
  container.addSectionComponents(spamDetectionSection);

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Additional info
  const infoText = new TextDisplayBuilder().setContent(
    "-# Timeouts will be tracked in your mod log channel if one is configured.",
  );
  container.addTextDisplayComponents(infoText);
}
