import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import {
  createToggleButton,
  formatMessageSetting,
  formatToggleSetting,
} from "../components/SettingsComponents";
import type { SettingsMessageOptions } from "../components/SettingsConstants";
import { SETTINGS_CUSTOM_IDS } from "../components/SettingsConstants";

export function addModerationContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
  _interaction?: Interaction<CacheType>,
): void {
  const { config, disabled = false } = options;

  // Header
  const headerText = new TextDisplayBuilder().setContent(
    "## Moderation Settings",
  );
  container.addTextDisplayComponents(headerText);

  // Lookup Settings Section
  const lookupIntro = new TextDisplayBuilder().setContent(
    "### Lookup Settings\nWhen using `/lookup` to check user bans:" +
      "\n- **Share Details**: See other servers' names and ban reasons (recommended for better moderation)" +
      "\n- **Keep Private**: Only see ban dates (no server names or reasons)" +
      "\n💡 **Note**: To see details from other servers, you must also share yours.\n",
  );
  container.addTextDisplayComponents(lookupIntro);

  // Lookup Data Sharing Section
  const lookupTextContent = formatToggleSetting(
    "🔍 Lookup Data Sharing",
    config.moderationSettings.lookupDetailsOptIn,
    config.moderationSettings.lookupDetailsOptIn
      ? "Sharing server name and ban reasons with other servers"
      : "Keeping server name and ban reasons private",
  );

  const lookupText = new TextDisplayBuilder().setContent(lookupTextContent);
  const lookupSection = new SectionBuilder()
    .addTextDisplayComponents(lookupText)
    .setButtonAccessory(
      createToggleButton(
        config.moderationSettings.lookupDetailsOptIn,
        SETTINGS_CUSTOM_IDS.TOGGLE_LOOKUP_OPT_IN,
        disabled,
      ),
    );
  container.addSectionComponents(lookupSection);
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // DM Settings Section
  const dmIntroText =
    "\n### Default DM Settings" +
    "\nChoose when the bot sends DMs to users for moderation actions." +
    "\n💡 **Tip:** You can override these per command using the `dm_reason` option.\n";
  const dmIntro = new TextDisplayBuilder().setContent(dmIntroText);
  container.addTextDisplayComponents(dmIntro);

  // Timeout Command DM Section
  const timeoutCommandContent = formatToggleSetting(
    "⏳ DM on `/timeout` command",
    config.moderationSettings.timeoutCommandDmEnabled,
    "When you use the `/timeout` command, send them a DM with the reason",
  );
  const timeoutCommandText = new TextDisplayBuilder().setContent(
    timeoutCommandContent,
  );
  const timeoutCommandSection = new SectionBuilder()
    .addTextDisplayComponents(timeoutCommandText)
    .setButtonAccessory(
      createToggleButton(
        config.moderationSettings.timeoutCommandDmEnabled,
        SETTINGS_CUSTOM_IDS.TOGGLE_TIMEOUT_COMMAND_DM,
        disabled,
      ),
    );
  container.addSectionComponents(timeoutCommandSection);

  // Divider
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Timeout Native DM Section
  const timeoutNativeContent = formatToggleSetting(
    "⏳ DM on Discord Timeout",
    config.moderationSettings.timeoutNativeDmEnabled,
    "When you right-click a user → Timeout, send them a DM with the reason",
  );
  const timeoutNativeText = new TextDisplayBuilder().setContent(
    timeoutNativeContent,
  );
  const timeoutNativeSection = new SectionBuilder()
    .addTextDisplayComponents(timeoutNativeText)
    .setButtonAccessory(
      createToggleButton(
        config.moderationSettings.timeoutNativeDmEnabled,
        SETTINGS_CUSTOM_IDS.TOGGLE_TIMEOUT_NATIVE_DM,
        disabled,
      ),
    );
  container.addSectionComponents(timeoutNativeSection);

  // Divider
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  let timeoutMessageContent = "";
  timeoutMessageContent += formatMessageSetting(
    "⏳ Timeout DM Message",
    config.moderationSettings.timeoutDmText,
    "Optional extra message added to timeout DMs. Users always see the timeout reason, but you can add server rules or appeal info here.",
  );

  const timeoutMessageText = new TextDisplayBuilder().setContent(
    timeoutMessageContent,
  );
  container.addTextDisplayComponents(timeoutMessageText);
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  const timeoutTextRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SETTINGS_CUSTOM_IDS.EDIT_TIMEOUT_DM_TEXT)
      .setLabel("Edit Timeout DM Message")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
  container.addActionRowComponents(timeoutTextRow);

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Warn DM Settings
  let warnContent = "";
  warnContent += formatMessageSetting(
    "⚠️ Warn DM Message",
    config.moderationSettings.warnDmText,
    "Optional extra message added to warning DMs. Users always see the warning reason, but you can add rule reminders or support info here.",
  );

  const dmText2 = new TextDisplayBuilder().setContent(warnContent);
  container.addTextDisplayComponents(dmText2);

  // Warn button
  const warnTextRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SETTINGS_CUSTOM_IDS.EDIT_WARN_DM_TEXT)
      .setLabel("Edit Warn DM Message")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
  container.addActionRowComponents(warnTextRow);

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Ban DM Settings
  const banToggleContent = formatToggleSetting(
    "🔨 Ban DM",
    config.moderationSettings.banDmEnabled,
    "Always DM the user when banned." +
      "\n ⚠️ **Important:** Only works with `/ban` command. Right-click bans can't send DMs.",
  );
  const banToggleText = new TextDisplayBuilder().setContent(banToggleContent);
  const banToggleSection = new SectionBuilder()
    .addTextDisplayComponents(banToggleText)
    .setButtonAccessory(
      createToggleButton(
        config.moderationSettings.banDmEnabled,
        SETTINGS_CUSTOM_IDS.TOGGLE_BAN_DM,
        disabled,
      ),
    );
  container.addSectionComponents(banToggleSection);
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  let banMessageContent = "";
  banMessageContent += formatMessageSetting(
    "🔨 Ban DM Message",
    config.moderationSettings.banDmText,
    "Optional extra message added to ban DMs. Users always see the ban reason, but you can add appeal links or final instructions here.",
  );

  const banMessageText = new TextDisplayBuilder().setContent(banMessageContent);
  container.addTextDisplayComponents(banMessageText);

  const banTextRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SETTINGS_CUSTOM_IDS.EDIT_BAN_DM_TEXT)
      .setLabel("Edit Ban DM Text")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
  container.addActionRowComponents(banTextRow);
}
