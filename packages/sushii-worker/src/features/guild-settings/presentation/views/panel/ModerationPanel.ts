import type { ContainerBuilder } from "discord.js";

import type { RowState } from "@/features/guild-settings/application/SettingsStatus";

import {
  attentionDetail,
  divider,
  editButton,
  quoteSnippet,
  rowSection,
  smallText,
  statusIcon,
  text,
  toggleButton,
} from "./panelParts";
import type { PanelInput } from "./panelTypes";

function timeoutValue(input: PanelInput): string {
  const { timeoutCommandDmEnabled, timeoutNativeDmEnabled } =
    input.config.moderationSettings;

  if (timeoutCommandDmEnabled && timeoutNativeDmEnabled) {
    return "`/timeout` and right-click timeouts";
  }
  if (timeoutCommandDmEnabled) {
    return "`/timeout` only";
  }
  if (timeoutNativeDmEnabled) {
    return "Right-click timeouts only";
  }
  return "Off";
}

function dmTextDetail(
  state: RowState,
  dmText: string | null,
  fallback?: string,
): string | null {
  if (state.kind === "off") {
    return null;
  }
  if (dmText?.trim()) {
    return smallText(quoteSnippet(dmText));
  }
  return fallback ? smallText(fallback) : null;
}

function attentionLine(state: RowState): string | null {
  return state.kind === "attention"
    ? smallText(attentionDetail(state.problem, null))
    : null;
}

export function addModerationPanel(
  container: ContainerBuilder,
  input: PanelInput,
): void {
  const mod = input.config.moderationSettings;
  const states = input.status.moderation;
  const icon = (state: RowState): string =>
    statusIcon(input.emojis, state.kind);

  container.addTextDisplayComponents(text("**DMs sent to members**"));

  const timeout = states["dm-timeout"];
  container.addSectionComponents(
    rowSection({
      icon: icon(timeout),
      name: "Timeout",
      value: timeoutValue(input),
      details: [
        attentionLine(timeout),
        dmTextDetail(timeout, mod.timeoutDmText),
      ],
      accessory: editButton("dm-timeout", input.expired),
    }),
  );

  const warn = states["dm-warn"];
  container.addSectionComponents(
    rowSection({
      icon: icon(warn),
      name: "Warn",
      value: "Always sent",
      details: [dmTextDetail(warn, mod.warnDmText, "Default text")],
      accessory: editButton("dm-warn", input.expired),
    }),
  );

  const ban = states["dm-ban"];
  container.addSectionComponents(
    rowSection({
      icon: icon(ban),
      name: "Ban",
      value: ban.kind === "off" ? "Off" : "`/ban` only",
      details: [dmTextDetail(ban, mod.banDmText)],
      accessory: editButton("dm-ban", input.expired),
    }),
  );

  const kick = states["dm-kick"];
  container.addSectionComponents(
    rowSection({
      icon: icon(kick),
      name: "Kick",
      value: kick.kind === "off" ? "Off" : "`/kick` only",
      details: [dmTextDetail(kick, mod.kickDmText)],
      accessory: editButton("dm-kick", input.expired),
    }),
  );

  container.addSeparatorComponents(divider());

  const lookup = states.lookup;
  const lookupOn = lookup.kind === "on";
  container.addSectionComponents(
    rowSection({
      icon: icon(lookup),
      name: "Lookup sharing",
      value: lookupOn
        ? "Other servers see your server name and ban reasons in `/lookup`"
        : "Off",
      details: lookupOn
        ? []
        : [smallText("Share your server name and ban reasons in `/lookup`")],
      accessory: toggleButton("lookup", lookupOn, input.expired),
    }),
  );
}
