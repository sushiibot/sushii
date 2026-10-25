import type { Client, ContainerBuilder } from "discord.js";
import { DiscordAPIError, MessageFlags, RESTJSONErrorCodes } from "discord.js";

import type {
  ScreeningPostEditResult,
  ScreeningPostPublisher,
} from "../application/ScreeningPostPublisher";

function isGone(err: unknown): boolean {
  return (
    err instanceof DiscordAPIError &&
    (err.code === RESTJSONErrorCodes.UnknownMessage ||
      err.code === RESTJSONErrorCodes.UnknownChannel)
  );
}

/** Posts mention the member and quote their text, so mentions are never parsed. */
export class DiscordScreeningPostPublisher implements ScreeningPostPublisher {
  constructor(private readonly client: Client) {}

  async post(channelId: string, container: ContainerBuilder): Promise<string> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isSendable()) {
      throw new Error("Screening log channel is not sendable", {
        cause: { channelId },
      });
    }

    const sent = await channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });

    return sent.id;
  }

  async edit(
    channelId: string,
    messageId: string,
    container: ContainerBuilder,
  ): Promise<ScreeningPostEditResult> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        throw new Error("Screening log channel is not text based", {
          cause: { channelId },
        });
      }

      await channel.messages.edit(messageId, {
        components: [container],
        allowedMentions: { parse: [] },
      });
      return "edited";
    } catch (err) {
      if (isGone(err)) {
        return "gone";
      }
      throw err;
    }
  }
}
