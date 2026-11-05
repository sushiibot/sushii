import type { InteractionUpdateOptions } from "discord.js";
import {
  ActionRowBuilder,
  type ButtonBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import type { PromptContent } from "../../domain/PromptDefinition";
import { makeCustomId } from "../../presentation/customIds";
import {
  dismissButton,
  snoozeButton,
} from "../../presentation/views/buildPromptMessage";

export const FOLLOW_UPDATES_ID = "follow_updates";
export const FOLLOW_UPDATES_SNOOZE_DAYS = 30;

export const FOLLOW_UPDATES_ACTION = {
  pickChannel: "channel_select",
} as const;

type ComponentsV2Update = InteractionUpdateOptions & {
  flags: MessageFlags.IsComponentsV2;
};

export function buildPickChannelContent(): PromptContent {
  const text = [
    "## 🔔 Pick a channel for sushii notifications",
    "sushii tells you there when something in your server needs fixing, like a missing permission. It also posts sushii updates about new features.",
    "-# You don't need to join the support server.",
  ].join("\n");

  return {
    text,
    accentColor: Color.Info,
    rows: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(
            makeCustomId(FOLLOW_UPDATES_ID, FOLLOW_UPDATES_ACTION.pickChannel),
          )
          .setPlaceholder("Choose a channel")
          .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setMinValues(1)
          .setMaxValues(1),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        snoozeButton(FOLLOW_UPDATES_ID, FOLLOW_UPDATES_SNOOZE_DAYS),
        dismissButton(FOLLOW_UPDATES_ID),
      ),
    ],
  };
}

export function buildNotificationsOnMessage(
  channelId: string,
  updatesEnabled: boolean,
): ComponentsV2Update {
  const updates = updatesEnabled ? ", plus sushii updates" : "";
  const container = new ContainerBuilder()
    .setAccentColor(Color.Success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "## ✅ sushii notifications are on",
          `sushii will post in <#${channelId}> when something needs fixing${updates}.`,
          "-# Change this in /settings → Logging → sushii notifications.",
        ].join("\n"),
      ),
    );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function cantSendText(channelId: string): string {
  return `sushii can't post in <#${channelId}>. Give it **View Channel** and **Send Messages** there, or pick another channel.`;
}
