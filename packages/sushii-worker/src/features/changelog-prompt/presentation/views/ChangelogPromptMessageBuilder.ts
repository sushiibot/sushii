import type { InteractionReplyOptions, InteractionUpdateOptions } from "discord.js";
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

import { CUSTOM_IDS } from "../ChangelogPromptConstants";

type ComponentsV2Reply = InteractionReplyOptions & { flags: MessageFlags.IsComponentsV2 };
type ComponentsV2Update = InteractionUpdateOptions & { flags: MessageFlags.IsComponentsV2 };

export function buildChangelogPromptMessage(
  botHasManageWebhooks: boolean,
): ComponentsV2Reply {
  let content = "## 📢 Get sushii updates in your server\n";
  content +=
    "Stay informed about new features, improvements, and fixes — update posts will appear in the channel you choose.\n\n";
  content += "**Pick a channel to receive updates:**";

  if (!botHasManageWebhooks) {
    content +=
      "\n\n-# ⚠️ sushii needs the **Manage Webhooks** permission to follow channels. Grant it in Server Settings → Roles, then try again.";
  }

  const container = new ContainerBuilder().setAccentColor(Color.Info);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  const channelSelectRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.CHANNEL_SELECT)
      .setPlaceholder("Choose a channel for updates")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1),
  );
  container.addActionRowComponents(channelSelectRow);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.SNOOZE)
      .setLabel("Remind me in 7 days")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.DISMISS)
      .setLabel("Don't show again")
      .setStyle(ButtonStyle.Secondary),
  );
  container.addActionRowComponents(buttonRow);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
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
    new TextDisplayBuilder().setContent(`## ❌ Couldn't follow updates channel\n${message}`),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildSnoozedMessage(): ComponentsV2Update {
  const container = new ContainerBuilder().setAccentColor(Color.DiscordGrey);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "-# Got it — will remind you in 7 days.",
    ),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildDismissedMessage(): ComponentsV2Update {
  const container = new ContainerBuilder().setAccentColor(Color.DiscordGrey);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Got it, won't ask again."),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
