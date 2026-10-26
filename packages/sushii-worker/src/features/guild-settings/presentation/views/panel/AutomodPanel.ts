import type { ContainerBuilder } from "discord.js";

import type { RowState } from "@/features/guild-settings/application/SettingsStatus";
import type { ScreeningSettingsState } from "@/features/member-screening/application/ScreeningSettingsPort";

import {
  attentionDetail,
  channelMention,
  divider,
  editButton,
  rowSection,
  smallText,
  statusIcon,
  toggleButton,
} from "./panelParts";
import type { PanelInput } from "./panelTypes";

function screeningValue(
  state: RowState,
  screening: ScreeningSettingsState,
): string {
  if (state.kind === "off" || !screening.logChannelId) {
    return "Off";
  }

  const avatars = screening.checkAvatars ? " · checks avatars" : "";
  return `Reviews in ${channelMention(screening.logChannelId)}${avatars}`;
}

// DiscordModLogService only posts while the mod log is on.
function modLogNote(input: PanelInput): string {
  const state = input.status.logging.modlog;
  const channelId = input.config.loggingSettings.modLogChannel;
  if (state.kind === "on" && channelId) {
    return `Actions are always logged in ${channelMention(channelId)}`;
  }
  if (state.kind === "attention") {
    return "Actions aren't logged until your mod log is fixed";
  }
  return "Actions are logged in your mod log when it's on";
}

export function addAutomodPanel(
  container: ContainerBuilder,
  input: PanelInput,
): void {
  const mod = input.config.moderationSettings;
  const states = input.status.automod;
  const icon = (state: RowState): string =>
    statusIcon(input.emojis, state.kind);
  // Settings with no on/off of their own only flag problems.
  const attentionOnlyIcon = (state: RowState): string =>
    state.kind === "attention" ? icon(state) : "";

  const scamOn = states.scam.kind === "on";
  container.addSectionComponents(
    rowSection({
      icon: icon(states.scam),
      name: "Scam images",
      value: scamOn ? "Times out on a match" : "Off",
      accessory: toggleButton("scam", scamOn, input.expired),
    }),
  );

  const spamOn = states.spam.kind === "on";
  container.addSectionComponents(
    rowSection({
      icon: icon(states.spam),
      name: "Spam",
      value: spamOn ? "Times out cross-channel spam" : "Off",
      accessory: toggleButton("spam", spamOn, input.expired),
    }),
  );

  if (input.screening && states.screening) {
    const state = states.screening;
    container.addSectionComponents(
      rowSection({
        icon: icon(state),
        name: "Member screening",
        value: screeningValue(state, input.screening),
        details: [
          state.kind === "attention"
            ? smallText(
                attentionDetail(state.problem, input.screening.logChannelId),
              )
            : null,
        ],
        accessory: editButton("screening", input.expired),
      }),
    );
  }

  container.addSeparatorComponents(divider());

  const exemptRoles = mod.automodExemptRoleIds;
  container.addSectionComponents(
    rowSection({
      icon: attentionOnlyIcon(states.exempt),
      name: "Exempt roles",
      value:
        exemptRoles.length > 0
          ? exemptRoles.map((id) => `<@&${id}>`).join(", ")
          : "Not set",
      details: [smallText("Skipped by scam images and spam")],
      accessory: editButton("exempt", input.expired),
    }),
  );

  const alertsChannelId = mod.automodAlertsChannelId;
  container.addSectionComponents(
    rowSection({
      icon: attentionOnlyIcon(states.alerts),
      name: "Alerts channel",
      value: alertsChannelId ? channelMention(alertsChannelId) : "Not set",
      details: [
        states.alerts.kind === "attention"
          ? smallText(attentionDetail(states.alerts.problem, alertsChannelId))
          : null,
        smallText(modLogNote(input)),
      ],
      accessory: editButton("alerts", input.expired),
    }),
  );
}
