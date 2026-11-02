import type { ContainerBuilder } from "discord.js";

import type { RowState } from "@/features/guild-settings/application/SettingsStatus";
import type { IpGrabberSettingsState } from "@/features/ip-grabber-links/application/IpGrabberSettingsPort";
import { IP_GRABBER_PROVIDERS } from "@/features/ip-grabber-links/domain/providers";
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

function ipGrabberValue(
  state: RowState,
  ipGrabbers: IpGrabberSettingsState,
): string {
  if (state.kind === "attention") {
    return ipGrabbers.problem === "rule_missing"
      ? "Rule was deleted"
      : `Can't update **${ipGrabbers.ruleName ?? "the rule"}**`;
  }
  if (state.kind === "off" || !ipGrabbers.ruleId) {
    return "Off";
  }

  const domains = ipGrabbers.keywordCount === 1 ? "domain" : "domains";
  return `Blocks ${ipGrabbers.keywordCount} ${domains} in **${ipGrabbers.ruleName ?? "your rule"}**`;
}

function ipGrabberDetail(ipGrabbers: IpGrabberSettingsState): string | null {
  if (!ipGrabbers.ruleId) {
    return null;
  }

  const names = ipGrabbers.providers
    .map((id) => IP_GRABBER_PROVIDERS[id].name)
    .join(", ");
  const synced = ipGrabbers.lastSyncedAt
    ? ` · synced <t:${Math.floor(ipGrabbers.lastSyncedAt.getTime() / 1000)}:R>`
    : "";
  return names ? `${names}${synced}` : null;
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

  // Headings only matter once Discord AutoMod settings share the tab.
  const showIpGrabbers = !!(input.ipGrabbers && states.ipGrabbers);

  const scamOn = states.scam.kind === "on";
  container.addSectionComponents(
    rowSection({
      heading: showIpGrabbers
        ? `**sushii automod**\n${smallText("Checks sushii runs itself")}\n`
        : undefined,
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

  if (input.ipGrabbers && states.ipGrabbers) {
    const state = states.ipGrabbers;
    const detail = ipGrabberDetail(input.ipGrabbers);
    container.addSeparatorComponents(divider());
    container.addSectionComponents(
      rowSection({
        heading: `**Discord AutoMod**\n${smallText("Lists sushii keeps up to date in your own AutoMod rules. Exemptions and alerts are set in Server Settings → AutoMod.")}\n`,
        icon: icon(state),
        name: "IP grabber links",
        value: ipGrabberValue(state, input.ipGrabbers),
        details: [
          state.kind === "attention"
            ? smallText(attentionDetail(state.problem, null))
            : null,
          state.kind === "on" && detail ? smallText(detail) : null,
        ],
        accessory: editButton("ip-grabbers", input.expired),
      }),
    );
  }
}
