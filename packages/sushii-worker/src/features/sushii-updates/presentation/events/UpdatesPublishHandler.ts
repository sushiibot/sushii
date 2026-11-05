import type {
  Message,
  OmitPartialGroupDMChannel,
  PartialMessage,
} from "discord.js";
import { DiscordAPIError, Events, RESTJSONErrorCodes } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { SushiiUpdatesCaptureService } from "../../application/SushiiUpdatesCaptureService";

type UpdatedMessage = OmitPartialGroupDMChannel<Message | PartialMessage>;

async function fetchUnlessDeleted(
  partial: OmitPartialGroupDMChannel<PartialMessage>,
): Promise<Message | null> {
  try {
    return await partial.fetch();
  } catch (err) {
    if (
      err instanceof DiscordAPIError &&
      err.code === RESTJSONErrorCodes.UnknownMessage
    ) {
      return null;
    }
    throw err;
  }
}

/** Publishing an announcement sends MESSAGE_UPDATE with the Crossposted flag; that's the relay trigger. */
export class UpdatesPublishHandler extends EventHandler<Events.MessageUpdate> {
  readonly eventType = Events.MessageUpdate;

  // Capture is an idempotent DB write and only the active slot sends, so both slots capture and a switch can't lose a publish.
  readonly isExemptFromDeploymentCheck = true;

  constructor(
    private readonly sourceChannelId: string,
    private readonly capture: Pick<SushiiUpdatesCaptureService, "capture">,
  ) {
    super();
  }

  async handle(_old: UpdatedMessage, updated: UpdatedMessage): Promise<void> {
    if (updated.channelId !== this.sourceChannelId) {
      return;
    }

    // The message cache is disabled, so updates can arrive partial.
    const message = updated.partial
      ? await fetchUnlessDeleted(updated)
      : updated;
    if (!message) {
      return;
    }
    await this.capture.capture(
      {
        id: message.id,
        flags: message.flags.bitfield,
        type: message.type,
        authorId: message.author.id,
      },
      message.client.user.id,
    );
  }
}
