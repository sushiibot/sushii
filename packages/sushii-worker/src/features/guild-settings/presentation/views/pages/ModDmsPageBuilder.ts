import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
import {
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";

import {
  createEditSection,
} from "../components/SettingsComponents";
import type { SettingsMessageOptions } from "../components/SettingsConstants";
import { SETTINGS_CUSTOM_IDS } from "../components/SettingsConstants";

export function addModDmsContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
  _interaction?: Interaction<CacheType>,
): void {
  const { config, disabled = false } = options;

  // Header
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Mod DMs"),
  );

  // Section header + intro
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "### DM Message Templates\n" +
      "Extra text sent alongside moderation DMs. Add server rules, appeal links, or additional context.",
    ),
  );

  // Timeout DM Text
  container.addSectionComponents(
    createEditSection(
      "Timeout DM Text",
      "Extra message added to timeout DMs.",
      SETTINGS_CUSTOM_IDS.MODALS.EDIT_TIMEOUT_DM_TEXT,
      disabled,
    ),
  );
  if (config.moderationSettings.timeoutDmText) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `> ${config.moderationSettings.timeoutDmText.replace(/\n/g, "\n> ")}`,
      ),
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# No custom message set"),
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  // Warn DM Text
  container.addSectionComponents(
    createEditSection(
      "Warn DM Text",
      "Extra message added to warning DMs.",
      SETTINGS_CUSTOM_IDS.MODALS.EDIT_WARN_DM_TEXT,
      disabled,
    ),
  );
  if (config.moderationSettings.warnDmText) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `> ${config.moderationSettings.warnDmText.replace(/\n/g, "\n> ")}`,
      ),
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# No custom message set"),
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  // Ban DM Text
  container.addSectionComponents(
    createEditSection(
      "Ban DM Text",
      "Extra message added to ban DMs. Add appeal links or final instructions here.",
      SETTINGS_CUSTOM_IDS.MODALS.EDIT_BAN_DM_TEXT,
      disabled,
    ),
  );
  if (config.moderationSettings.banDmText) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `> ${config.moderationSettings.banDmText.replace(/\n/g, "\n> ")}`,
      ),
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# No custom message set"),
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  // Kick DM Text
  container.addSectionComponents(
    createEditSection(
      "Kick DM Text",
      "Extra message added to kick DMs. Add appeal links or additional instructions here.",
      SETTINGS_CUSTOM_IDS.MODALS.EDIT_KICK_DM_TEXT,
      disabled,
    ),
  );
  if (config.moderationSettings.kickDmText) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `> ${config.moderationSettings.kickDmText.replace(/\n/g, "\n> ")}`,
      ),
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# No custom message set"),
    );
  }
}
