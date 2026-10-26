import type { GatewayDispatchPayload } from "discord.js";
import { Events, GatewayDispatchEvents } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { MemberScreeningService } from "../../application/MemberScreeningService";
import type { ScreeningSettingsLookup } from "../../application/ScreeningSettingsLookup";

export class ScreeningMessageDeleteHandler extends EventHandler<Events.Raw> {
  readonly eventType = Events.Raw;

  constructor(
    private readonly service: MemberScreeningService,
    private readonly settings: Pick<ScreeningSettingsLookup, "find">,
  ) {
    super();
  }

  async handle(event: GatewayDispatchPayload): Promise<void> {
    let guildId: string | undefined;
    let messageIds: string[];
    if (event.t === GatewayDispatchEvents.MessageDelete) {
      guildId = event.d.guild_id;
      messageIds = [event.d.id];
    } else if (event.t === GatewayDispatchEvents.MessageDeleteBulk) {
      guildId = event.d.guild_id;
      messageIds = event.d.ids;
    } else {
      return;
    }

    if (!guildId) {
      return;
    }

    const settings = await this.settings.find(guildId);
    if (!settings) {
      return;
    }

    await this.service.recordMessagesDeleted(messageIds);
  }
}
