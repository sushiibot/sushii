import type { GatewayDispatchPayload } from "discord.js";
import { Events, GatewayDispatchEvents } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { IpGrabberDiscoveryService } from "../../application/IpGrabberDiscoveryService";

export class IpGrabberLinkHandler extends EventHandler<Events.Raw> {
  readonly eventType = Events.Raw;

  constructor(
    private readonly discoveryService: IpGrabberDiscoveryService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handle(event: GatewayDispatchPayload): Promise<void> {
    if (event.t !== GatewayDispatchEvents.MessageCreate) {
      return;
    }

    const payload = event.d;
    if (!payload.guild_id || payload.author.bot || !payload.content) {
      return;
    }

    // Detection does network lookups; message handling shouldn't wait on them.
    this.discoveryService
      .observe({
        guildId: payload.guild_id,
        channelId: payload.channel_id,
        content: payload.content,
      })
      .catch((err: unknown) => {
        this.logger.error(
          { err, guildId: payload.guild_id },
          "IP grabber link check failed",
        );
      });
  }
}
