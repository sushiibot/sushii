import type {
  ContainerBuilder} from "discord.js";
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
import type {
  SettingsMessageOptions} from "../components/SettingsConstants";
import {
  SETTINGS_CUSTOM_IDS
} from "../components/SettingsConstants";

export function addModerationContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
): void {
  const { config, disabled = false } = options;

  // Header
  const headerText = new TextDisplayBuilder().setContent(
    "## Moderation Settings",
  );
  container.addTextDisplayComponents(headerText);

  // Lookup Settings Section
  const lookupIntro = new TextDisplayBuilder().setContent(
    "### Lookup Settings\nWith the lookup command, you can see bans from other servers. You can either keep your server name and ban reasons private, or share them with other servers. In order to see the server name and ban reasons from other servers, you must also share your server name and ban reasons.\n",
  );
  container.addTextDisplayComponents(lookupIntro);

  // Lookup Data Sharing Section
  const lookupTextContent = formatToggleSetting(
    "🔍 Lookup Data Sharing",
    config.moderationSettings.lookupDetailsOptIn,
    config.moderationSettings.lookupDetailsOptIn
      ? "Sharing server name, ban reasons with other servers"
      : "Only sharing ban timestamps (server name & reasons hidden)",
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
    "\nChoose when the bot sends DMs to users by default for moderation actions, including your custom reason." +
    "\n**Tip:** Override any of these per command using the `dm_reason` option.\n";
  const dmIntro = new TextDisplayBuilder().setContent(dmIntroText);
  container.addTextDisplayComponents(dmIntro);

  // Timeout Command DM Section
  const timeoutCommandContent = formatToggleSetting(
    "⏳ DM on `/timeout` command",
    config.moderationSettings.timeoutCommandDmEnabled,
    "> When you run the `/timeout` command, send them a DM with the reason",
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
    "> When you timeout via right-clicking a user, send them a DM with the reason",
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
    "Optional extra message sent with timeouts. Users will always be told they were timed out, but you can add server-specific info like appeal instructions or rule reminders.",
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
    "Optional extra message sent with warnings. Users will always be told they received a warning, but you can add helpful info like which rules to review or where to get help.",
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
    "> Always DM the user when banned." +
      "\n> **Note:** This will ONLY work if you use the `/ban` command, not Discord's native ban action as bots cannot DM users that are no longer in the server.",
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
    "Optional extra message sent with bans. Users will always be told they were banned, but you can add server-specific info like an appeal link.",
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
