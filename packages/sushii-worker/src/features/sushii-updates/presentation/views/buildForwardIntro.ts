import type { RESTPostAPIChannelMessageJSONBody } from "discord.js";
import {
  ActionRowBuilder,
  type ButtonBuilder,
  ContainerBuilder,
  MessageFlags,
  MessageReferenceType,
  TextDisplayBuilder,
} from "discord.js";

import { buildSupportServerButton } from "@/shared/presentation/supportServer";
import Color from "@/utils/colors";

export interface ForwardSource {
  guildId: string;
  channelId: string;
  messageId: string;
}

/** A forward carries only the reference; Discord snapshots the source when it's sent. */
export function buildForwardBody(
  source: ForwardSource,
): RESTPostAPIChannelMessageJSONBody {
  return {
    message_reference: {
      type: MessageReferenceType.Forward,
      message_id: source.messageId,
      channel_id: source.channelId,
      guild_id: source.guildId,
    },
  };
}

/** Sent at most once per server, after its first forwarded update. */
export function buildFirstForwardFooter(
  settingsMention: string,
): RESTPostAPIChannelMessageJSONBody {
  const container = new ContainerBuilder()
    .setAccentColor(Color.Info)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# This is a sushii update from the support server. Turn it off in ${settingsMention} → Logging → sushii notifications.`,
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        buildSupportServerButton(),
      ),
    );

  return {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowed_mentions: { parse: [] },
  };
}
