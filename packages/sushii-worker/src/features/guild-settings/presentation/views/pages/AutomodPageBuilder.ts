import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import type { ScreeningSettingsState } from "@/features/member-screening/application/ScreeningSettingsPort";
import { MAX_AUTOMOD_EXEMPT_ROLES } from "@/shared/domain/entities/GuildConfig";

import { formatPermissionWarning } from "../../utils/PermissionChecker";
import { addToggleSetting } from "../components/SettingsComponents";
import type { SettingsMessageOptions } from "../components/SettingsConstants";
import { SETTINGS_CUSTOM_IDS } from "../components/SettingsConstants";

export function addAutomodContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
  _interaction?: Interaction<CacheType>,
): void {
  const { config, disabled = false, emojis } = options;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${emojis.shield} Automod`),
  );

  // Alerts Channel Section
  const alertsChannelId = config.moderationSettings.automodAlertsChannelId;
  const alertsPermStatus =
    alertsChannelId && options.channelPermissions?.[alertsChannelId];
  const alertsPermWarning = alertsPermStatus
    ? formatPermissionWarning(alertsPermStatus)
    : null;

  const modLogRef = config.loggingSettings.modLogChannel
    ? `<#${config.loggingSettings.modLogChannel}>`
    : "your mod log channel";

  const alertsDescription = [
    `### ${emojis.bell} Alerts Channel`,
    `Automod actions are always tracked in ${modLogRef}. Set an alerts channel to also receive notifications there.`,
    alertsPermWarning,
  ]
    .filter(Boolean)
    .join("\n");

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(alertsDescription),
  );

  const alertsChannelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.CHANNELS.SET_AUTOMOD_ALERTS)
    .setPlaceholder("Select alerts channel...")
    .setDefaultChannels(
      config.moderationSettings.automodAlertsChannelId
        ? [config.moderationSettings.automodAlertsChannelId]
        : [],
    )
    .setMaxValues(1)
    .setMinValues(0)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setDisabled(disabled);

  container.addActionRowComponents(
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      alertsChannelSelect,
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Known Scam Images Toggle Section
  addToggleSetting(
    container,
    `${emojis.shield} Known Scam Images`,
    "Times out users who post known scam images.",
    config.moderationSettings.automodScamImageEnabled,
    SETTINGS_CUSTOM_IDS.TOGGLES.AUTOMOD_SCAM_IMAGE,
    disabled,
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Spam Detection Toggle Section
  addToggleSetting(
    container,
    `${emojis.lightning} Spam Detection`,
    "Times out users who send the same message across multiple channels rapidly.",
    config.moderationSettings.automodSpamEnabled,
    SETTINGS_CUSTOM_IDS.TOGGLES.AUTOMOD_SPAM,
    disabled,
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  if (options.screening) {
    addMemberScreeningSection(container, options.screening, options);
  }

  // Exempt Roles Section
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### Exempt Roles\nMembers with any of these roles are skipped entirely by spam detection — no timeout, no alert.`,
    ),
  );

  const exemptRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.ROLES.SET_AUTOMOD_EXEMPT_ROLES)
    .setPlaceholder(`Select exempt roles (max ${MAX_AUTOMOD_EXEMPT_ROLES})...`)
    .setMinValues(0)
    .setMaxValues(MAX_AUTOMOD_EXEMPT_ROLES)
    .setDefaultRoles(config.moderationSettings.automodExemptRoleIds)
    .setDisabled(disabled);

  container.addActionRowComponents(
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      exemptRoleSelect,
    ),
  );
}

function formatScreeningStatus(screening: ScreeningSettingsState): string {
  if (!screening.enabled) {
    return "-# Off";
  }

  if (!screening.logChannelId) {
    return "-# ⚠️ Pick a log channel to start screening";
  }

  return `-# ✅ On · posting to <#${screening.logChannelId}>`;
}

// The header doubles as the Screening toggle's section to stay within 40 components.
function addMemberScreeningSection(
  container: ContainerBuilder,
  screening: ScreeningSettingsState,
  options: SettingsMessageOptions,
): void {
  const disabled = options.disabled ?? false;

  addToggleSetting(
    container,
    "🔍 Member Screening",
    [
      "Checks new members' messages, avatars and image links with AI during their first 20 messages or 72 hours, and posts suspicious ones for review.",
      formatScreeningStatus(screening),
    ].join("\n"),
    screening.enabled,
    SETTINGS_CUSTOM_IDS.SCREENING.TOGGLE,
    disabled,
  );

  const channelPermStatus =
    screening.logChannelId &&
    options.channelPermissions?.[screening.logChannelId];
  const channelPermWarning = channelPermStatus
    ? formatPermissionWarning(channelPermStatus)
    : null;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        "**Log channel**",
        "Where flagged members are posted for review.",
        channelPermWarning,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );

  const logChannelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.SCREENING.SET_CHANNEL)
    .setPlaceholder("Select screening log channel...")
    .setDefaultChannels(screening.logChannelId ? [screening.logChannelId] : [])
    .setMaxValues(1)
    .setMinValues(0)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setDisabled(disabled);

  container.addActionRowComponents(
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      logChannelSelect,
    ),
  );

  addToggleSetting(
    container,
    "Check profile pictures",
    "Also check new members' avatars.",
    screening.checkAvatars,
    SETTINGS_CUSTOM_IDS.SCREENING.TOGGLE_AVATARS,
    disabled,
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );
}
