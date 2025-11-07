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
  const headerText = new TextDisplayBuilder().setContent(
    "## Automod Settings",
  );
  container.addTextDisplayComponents(headerText);

  // Intro text
  const introText = new TextDisplayBuilder().setContent(
    "### Spam Detection\nAutomatic detection and handling of spam messages across multiple channels." +
      "\n💡 **How it works**: Detects when the same user sends identical messages to 3+ different channels within 5 seconds." +
      "\n🎯 **Target**: Hacked accounts spreading malicious links/messages" +
      "\n⚡ **Action**: Automatic 10-minute timeout with clear audit log reason\n",
  );
  container.addTextDisplayComponents(introText);

  // Spam Detection Toggle Section
  const spamDetectionContent = formatToggleSetting(
    "🛡️ Spam Detection",
    config.moderationSettings.automodSpamEnabled,
    config.moderationSettings.automodSpamEnabled
      ? "Automatically timing out users who spam identical messages across channels"
      : "Spam detection disabled - messages are not automatically moderated",
  );

  const spamDetectionText = new TextDisplayBuilder().setContent(spamDetectionContent);
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
    "### Important Notes" +
      "\n- ✅ **Timeouts appear in mod logs** - Discord's native audit log system creates mod log entries automatically" +
      "\n- ⚠️ **Current limitations**: Detection is hardcoded to 3+ channels within 5 seconds (may be configurable in future)" +
      "\n- 🤖 **Bot messages ignored** - Only human users are monitored for spam" +
      "\n- 🔒 **Memory efficient** - Only tracks recent messages temporarily, no permanent storage",
  );
  container.addTextDisplayComponents(infoText);
}