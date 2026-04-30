import type { InteractionUpdateOptions } from "discord.js";
import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";
import type { PromptContent } from "../../domain/PromptDefinition";
import { makeCustomId } from "../../presentation/customIds";

export const FOLLOW_UPDATES_ID = "follow_updates";

type ComponentsV2Update = InteractionUpdateOptions & { flags: MessageFlags.IsComponentsV2 };

export function buildFollowUpdatesContent(botHasManageWebhooks: boolean): PromptContent {
  let text =
    "## 📢 Get sushii updates in your server\n" +
    "Stay informed about new features, improvements, and fixes — update posts will appear in the channel you choose.\n\n" +
    "**Pick a channel to receive updates:**";

  if (!botHasManageWebhooks) {
    text +=
      "\n\n-# ⚠️ sushii needs the **Manage Webhooks** permission to follow channels. Grant it in Server Settings → Roles, then try again.";
  }

  const channelSelectRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(makeCustomId(FOLLOW_UPDATES_ID, "channel_select"))
      .setPlaceholder("Choose a channel for updates")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1),
  );

  return {
    text,
    accentColor: Color.Info,
    actionRow: channelSelectRow,
  };
}

export function buildFollowSuccessMessage(channelId: string): ComponentsV2Update {
  const container = new ContainerBuilder().setAccentColor(Color.Success);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ✅ Following sushii updates\nUpdate posts will now appear in <#${channelId}>.`,
    ),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildFollowErrorMessage(message: string): ComponentsV2Update {
  const container = new ContainerBuilder().setAccentColor(Color.Error);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ❌ Couldn't follow updates channel\n${message}`,
    ),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
