import type { ContainerBuilder } from "discord.js";

import type {
  AttentionItem,
  RowState,
} from "@/features/guild-settings/application/SettingsStatus";

import type {
  SettingsEditTarget,
  SettingsTab,
} from "../../session/settingsIds";
import { logChannelId } from "./LoggingPanel";
import {
  attentionDetail,
  channelMention,
  divider,
  isOnLike,
  statusIcon,
  text,
  withIcon,
} from "./panelParts";
import type { PanelInput } from "./panelTypes";

const ROW_NAMES: Record<SettingsEditTarget, string> = {
  modlog: "Mod log",
  memberlog: "Member log",
  msglog: "Message log",
  reactionlog: "Reaction log",
  "dm-timeout": "Timeout DM",
  "dm-warn": "Warn DM",
  "dm-ban": "Ban DM",
  "dm-kick": "Kick DM",
  "welcome-channel": "Welcome channel",
  join: "Join message",
  leave: "Leave message",
  exempt: "Exempt roles",
  alerts: "Alerts channel",
  screening: "Member screening",
};

function rowChannelId(
  input: PanelInput,
  row: SettingsEditTarget,
): string | null {
  switch (row) {
    case "modlog":
    case "memberlog":
    case "msglog":
    case "reactionlog":
      return logChannelId(input, row);
    case "welcome-channel":
    case "join":
    case "leave":
      return input.config.messageSettings.messageChannel;
    case "alerts":
      return input.config.moderationSettings.automodAlertsChannelId;
    case "screening":
      return input.screening?.logChannelId ?? null;
    default:
      return null;
  }
}

function attentionLine(input: PanelInput, item: AttentionItem): string {
  const name = `**${ROW_NAMES[item.row]}**`;
  const channelId = rowChannelId(input, item.row);
  const { problem } = item;

  if (problem.kind === "missing_permissions") {
    const where = channelId ? ` in ${channelMention(channelId)}` : "";
    return `- ${name} can't post${where}: needs ${problem.permissions.join(", ")}`;
  }
  if (problem.kind === "no_channel") {
    return `- ${name} is on, but no channel picked`;
  }
  return `- ${name} · ${attentionDetail(problem, channelId)}`;
}

function attentionSuffix(count: number): string {
  if (count === 0) {
    return "";
  }
  return ` · ${count} ${count === 1 ? "needs" : "need"} attention`;
}

function onCount(states: RowState[]): number {
  return states.filter(isOnLike).length;
}

export function addOverviewPanel(
  container: ContainerBuilder,
  input: PanelInput,
): void {
  const { status, emojis } = input;

  if (status.attention.length > 0) {
    container.addTextDisplayComponents(
      text(
        [
          withIcon(statusIcon(emojis, "attention"), "**Needs attention**"),
          ...status.attention.map((item) => attentionLine(input, item)),
        ].join("\n"),
      ),
    );
    container.addSeparatorComponents(divider());
  }

  const attentionCount = (tab: SettingsTab): number =>
    status.attention.filter((item) => item.tab === tab).length;

  const line = (
    tab: SettingsTab,
    name: string,
    anyOn: boolean,
    summary: string,
  ): string => {
    const kind = status.tabAttention[tab] ? "attention" : anyOn ? "on" : "off";
    return withIcon(
      statusIcon(emojis, kind),
      `**${name}** · ${summary}${attentionSuffix(attentionCount(tab))}`,
    );
  };

  const logsOn = onCount(Object.values(status.logging));
  const loggingSummary =
    logsOn === 0 && attentionCount("logging") === 0
      ? "None set up"
      : `${logsOn} of 4 on`;

  const mod = status.moderation;
  const dmsOn = onCount([
    mod["dm-timeout"],
    mod["dm-warn"],
    mod["dm-ban"],
    mod["dm-kick"],
  ]);
  const lookupOn = mod.lookup.kind === "on";

  const scamOn = status.automod.scam.kind === "on";
  const spamOn = status.automod.spam.kind === "on";
  const automodSummary =
    scamOn && spamOn
      ? "Scam images and spam on"
      : scamOn
        ? "Scam images on"
        : spamOn
          ? "Spam on"
          : "Off";

  const joinOn = isOnLike(status.welcome.join);
  const leaveOn = isOnLike(status.welcome.leave);
  const welcomeChannel = input.config.messageSettings.messageChannel;
  const welcomeWhat =
    joinOn && leaveOn
      ? "Join and leave messages"
      : joinOn
        ? "Join message"
        : leaveOn
          ? "Leave message"
          : null;
  const welcomeSummary = !welcomeWhat
    ? "Off"
    : welcomeChannel
      ? `${welcomeWhat} on in ${channelMention(welcomeChannel)}`
      : `${welcomeWhat} on, but no channel picked`;

  container.addTextDisplayComponents(
    text(
      [
        line("logging", "Logging", logsOn > 0, loggingSummary),
        line(
          "moderation",
          "Moderation",
          dmsOn > 0 || lookupOn,
          `${dmsOn} of 4 DMs on · lookup sharing ${lookupOn ? "on" : "off"}`,
        ),
        line("automod", "Automod", scamOn || spamOn, automodSummary),
        line("welcome", "Welcome", !!welcomeWhat, welcomeSummary),
      ].join("\n"),
    ),
  );

  container.addTextDisplayComponents(
    text(
      "-# More setup: `/levelrole` · `/rolemenu` · `/schedule-config` · `/tag-admin`",
    ),
  );
}
