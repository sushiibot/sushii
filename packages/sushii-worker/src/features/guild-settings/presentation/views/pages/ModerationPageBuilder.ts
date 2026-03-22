import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
import { TextDisplayBuilder } from "discord.js";

import { addToggleSetting } from "../components/SettingsComponents";
import type { SettingsMessageOptions } from "../components/SettingsConstants";
import { SETTINGS_CUSTOM_IDS } from "../components/SettingsConstants";

export function addModerationContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
  _interaction?: Interaction<CacheType>,
): void {
  const { config, disabled = false, emojis } = options;

  // Page header
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${emojis.ban} Moderation`,
    ),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "Choose when the bot sends DMs to users for moderation actions.\n" +
        "-# You can override these per command using the `dm_reason` option.",
    ),
  );

  addToggleSetting(
    container,
    `${emojis.timeout} DM on /timeout command`,
    "When you use the `/timeout` command, send them a DM with the reason",
    config.moderationSettings.timeoutCommandDmEnabled,
    SETTINGS_CUSTOM_IDS.TOGGLES.TIMEOUT_COMMAND_DM,
    disabled,
  );

  addToggleSetting(
    container,
    `${emojis.timeout} DM on Discord Timeout`,
    "When you right-click a user → Timeout, send them a DM with the reason",
    config.moderationSettings.timeoutNativeDmEnabled,
    SETTINGS_CUSTOM_IDS.TOGGLES.TIMEOUT_NATIVE_DM,
    disabled,
  );

  addToggleSetting(
    container,
    `${emojis.ban} Ban DM`,
    "Always DM the user when banned. Only works with `/ban` command — right-click bans cannot send DMs.",
    config.moderationSettings.banDmEnabled,
    SETTINGS_CUSTOM_IDS.TOGGLES.BAN_DM,
    disabled,
  );

  addToggleSetting(
    container,
    `${emojis.kick} Kick DM`,
    "DM the user when kicked. Only works with the `/kick` command — native kicks cannot send DMs.",
    config.moderationSettings.kickDmEnabled,
    SETTINGS_CUSTOM_IDS.TOGGLES.KICK_DM,
    disabled,
  );
}
