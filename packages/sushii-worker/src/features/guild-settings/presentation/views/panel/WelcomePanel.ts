import type { ContainerBuilder } from "discord.js";

import type { RowState } from "@/features/guild-settings/application/SettingsStatus";

import { quotedPreview } from "./messagePreview";
import {
  attentionDetail,
  channelMention,
  editButton,
  rowSection,
  smallText,
  statusIcon,
} from "./panelParts";
import type { PanelInput } from "./panelTypes";

export function addWelcomePanel(
  container: ContainerBuilder,
  input: PanelInput,
): void {
  const msgs = input.config.messageSettings;
  const states = input.status.welcome;
  const channelId = msgs.messageChannel;
  const icon = (state: RowState): string =>
    statusIcon(input.emojis, state.kind);

  const channelState = states["welcome-channel"];
  container.addSectionComponents(
    rowSection({
      icon: icon(channelState),
      name: "Channel",
      value: channelId ? channelMention(channelId) : "Not set",
      details: [
        channelState.kind === "attention"
          ? smallText(attentionDetail(channelState.problem, channelId))
          : null,
        channelId ? null : smallText("Join and leave messages need a channel"),
      ],
      accessory: editButton("welcome-channel", input.expired),
    }),
  );

  const messageRows = [
    { target: "join", name: "Join message", template: msgs.joinMessage },
    { target: "leave", name: "Leave message", template: msgs.leaveMessage },
  ] as const;

  // The Channel row already explains a broken shared channel.
  const channelProblemShown = channelState.kind === "attention";

  for (const { target, name, template } of messageRows) {
    const state = states[target];
    const sending = state.kind === "on" || state.kind === "attention";

    container.addSectionComponents(
      rowSection({
        icon: icon(state),
        name,
        value: sending ? undefined : "Off",
        details: [
          state.kind === "attention" && !channelProblemShown
            ? smallText(attentionDetail(state.problem, channelId))
            : null,
          sending && template ? quotedPreview(template, input.preview) : null,
        ],
        accessory: editButton(target, input.expired),
      }),
    );
  }
}
