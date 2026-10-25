import type { GatewayDispatchPayload } from "discord.js";
import { Events, GatewayDispatchEvents } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { MemberScreeningService } from "../../application/MemberScreeningService";
import type { ScreeningGuildRepository } from "../../domain/repositories/ScreeningGuildRepository";
import { ScreeningSettingsLookup } from "./ScreeningSettingsLookup";

export class ScreeningMessageDeleteHandler extends EventHandler<Events.Raw> {
  readonly eventType = Events.Raw;
  private readonly settings: ScreeningSettingsLookup;

  constructor(
    private readonly service: MemberScreeningService,
    guildRepo: ScreeningGuildRepository,
    logger: Logger,
    now: () => number = Date.now,
  ) {
    super();
    this.settings = new ScreeningSettingsLookup(guildRepo, logger, now);
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
