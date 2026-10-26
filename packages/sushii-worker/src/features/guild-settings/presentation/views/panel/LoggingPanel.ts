import type { ContainerBuilder } from "discord.js";

import type { RowState } from "@/features/guild-settings/application/SettingsStatus";

import { compareSnowflakes } from "../../utils/compareSnowflakes";
import {
  attentionDetail,
  channelMention,
  editButton,
  rowSection,
  smallText,
  statusIcon,
} from "./panelParts";
import type { PanelInput } from "./panelTypes";

type LogTarget = "modlog" | "memberlog" | "msglog" | "reactionlog";

export const LOG_ROWS: readonly { target: LogTarget; name: string }[] = [
  { target: "modlog", name: "Mod log" },
  { target: "memberlog", name: "Member log" },
  { target: "msglog", name: "Message log" },
  { target: "reactionlog", name: "Reaction log" },
];

export function logChannelId(
  input: Pick<PanelInput, "config">,
  target: LogTarget,
): string | null {
  const logs = input.config.loggingSettings;
  switch (target) {
    case "modlog":
      return logs.modLogChannel;
    case "memberlog":
      return logs.memberLogChannel;
    case "msglog":
      return logs.messageLogChannel;
    case "reactionlog":
      return logs.reactionLogChannel;
  }
}

const MAX_IGNORED_SHOWN = 10;

export function ignoredText(channelIds: string[]): string {
  if (channelIds.length === 0) {
    return "";
  }

  const sorted = [...channelIds].sort(compareSnowflakes);
  const shown = sorted.slice(0, MAX_IGNORED_SHOWN).map(channelMention);
  const rest = sorted.length - shown.length;
  return `Ignoring ${shown.join(", ")}${rest > 0 ? `, +${rest} more` : ""}`;
}

function logValue(state: RowState, channelId: string | null): string {
  if (state.kind === "off" || state.kind === "not_set" || !channelId) {
    return "Off";
  }

  return channelMention(channelId);
}

export function addLoggingPanel(
  container: ContainerBuilder,
  input: PanelInput,
): void {
  for (const { target, name } of LOG_ROWS) {
    const state = input.status.logging[target];
    const channelId = logChannelId(input, target);

    const details: string[] = [];
    if (state.kind === "attention") {
      details.push(smallText(attentionDetail(state.problem, channelId)));
    }
    if (
      target === "msglog" &&
      state.kind !== "off" &&
      input.ignoredChannelIds.length > 0
    ) {
      details.push(smallText(ignoredText(input.ignoredChannelIds)));
    }

    container.addSectionComponents(
      rowSection({
        icon: statusIcon(input.emojis, state.kind),
        name,
        value: logValue(state, channelId),
        details,
        accessory: editButton(target, input.expired),
      }),
    );
  }
}
