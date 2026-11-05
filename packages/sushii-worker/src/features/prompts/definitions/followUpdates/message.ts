import type { InteractionUpdateOptions } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
  follow: "follow",
} as const;

const NO_SUPPORT_SERVER_NEEDED =
  "-# You don't need to join the support server.";

type ComponentsV2Update = InteractionUpdateOptions & {
  flags: MessageFlags.IsComponentsV2;
};

function snoozeAndDismiss(): ButtonBuilder[] {
  return [
    snoozeButton(FOLLOW_UPDATES_ID, FOLLOW_UPDATES_SNOOZE_DAYS),
    dismissButton(FOLLOW_UPDATES_ID),
  ];
}

/** State A: no notifications channel yet. */
export function buildPickChannelContent(
  botHasManageWebhooks: boolean,
): PromptContent {
  const footer = botHasManageWebhooks
    ? NO_SUPPORT_SERVER_NEEDED
    : "-# ⚠️ sushii needs **Manage Webhooks** in that channel to post updates.";
  const text = [
    "## 📢 Get sushii updates in your server",
    "Pick a channel for **sushii notifications**. sushii posts new features, changes and planned downtime there, and tells you when something in your setup needs fixing.",
    footer,
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
      new ActionRowBuilder<ButtonBuilder>().addComponents(snoozeAndDismiss()),
    ],
  };
}

/** State B: the notifications channel is set but doesn't follow updates. */
export function buildFollowChannelContent(channelId: string): PromptContent {
  const text = [
    `## 📢 Get sushii updates in <#${channelId}> too?`,
    `<#${channelId}> is your sushii notifications channel. sushii can also post new features, changes and planned downtime there.`,
    NO_SUPPORT_SERVER_NEEDED,
  ].join("\n");

  return {
    text,
    accentColor: Color.Info,
    rows: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            makeCustomId(FOLLOW_UPDATES_ID, FOLLOW_UPDATES_ACTION.follow),
          )
          .setLabel("Follow sushii updates")
          .setStyle(ButtonStyle.Primary),
        ...snoozeAndDismiss(),
      ),
    ],
  };
}

function resultMessage(color: number, text: string): ComponentsV2Update {
  const container = new ContainerBuilder().setAccentColor(color);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildFollowSuccessMessage(
  channelId: string,
): ComponentsV2Update {
  return resultMessage(
    Color.Success,
    [
      "## ✅ Following sushii updates",
      `New features and changes will post in <#${channelId}>.`,
      "-# Change or turn this off in /settings → Logging → sushii notifications.",
    ].join("\n"),
  );
}

export function buildFollowErrorMessage(reason: string): ComponentsV2Update {
  return resultMessage(
    Color.Error,
    `## ❌ Couldn't follow sushii updates\n${reason}`,
  );
}
