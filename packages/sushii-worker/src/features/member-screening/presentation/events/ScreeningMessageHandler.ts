import type { Client, GatewayDispatchPayload } from "discord.js";
import { Events, GatewayDispatchEvents, MessageType } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type {
  MemberScreeningService,
  ScreenedMessage,
} from "../../application/MemberScreeningService";
import type { ScreeningSettingsLookup } from "../../application/ScreeningSettingsLookup";
import { isScreeningExempt } from "./screeningExemption";

export class ScreeningMessageHandler extends EventHandler<Events.Raw> {
  readonly eventType = Events.Raw;

  constructor(
    private readonly service: MemberScreeningService,
    private readonly settings: Pick<ScreeningSettingsLookup, "find">,
    private readonly client: Client,
  ) {
    super();
  }

  async handle(event: GatewayDispatchPayload): Promise<void> {
    if (
      event.t !== GatewayDispatchEvents.MessageCreate &&
      event.t !== GatewayDispatchEvents.MessageUpdate
    ) {
      return;
    }

    const d = event.d;
    if (!d.guild_id || d.author.bot || d.webhook_id) {
      return;
    }
    // AutoMod alerts (type 24) and other system messages are authored by the member but not sent by them.
    if (d.type !== MessageType.Default && d.type !== MessageType.Reply) {
      return;
    }

    const settings = await this.settings.find(d.guild_id);
    if (!settings) {
      return;
    }

    const member = d.member;
    if (!member?.joined_at) {
      return;
    }

    const guild = this.client.guilds.cache.get(d.guild_id);
    if (!guild || isScreeningExempt(guild, d.author.id, member.roles)) {
      return;
    }

    const msg: ScreenedMessage = {
      id: d.id,
      guildId: d.guild_id,
      channelId: d.channel_id,
      content: d.content,
      createdAt: new Date(d.timestamp),
      embeds: d.embeds.map((e) => ({ image: e.image, thumbnail: e.thumbnail })),
      author: {
        id: d.author.id,
        avatar: d.author.avatar,
        name: member.nick ?? d.author.global_name ?? d.author.username,
      },
      member: {
        joinedAt: new Date(member.joined_at),
        avatar: member.avatar ?? null,
      },
    };

    // Embeds unfurl in a later MESSAGE_UPDATE; its text was already judged on create.
    const skipText = event.t === GatewayDispatchEvents.MessageUpdate;
    // screenMessage never throws, and a classifier call shouldn't hold the event dispatch.
    void this.service.screenMessage(msg, { skipText });
  }
}
