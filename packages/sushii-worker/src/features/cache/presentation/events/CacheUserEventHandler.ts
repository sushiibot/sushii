import { Events } from "discord.js";
import type { Message } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { CacheService } from "../../application";

export class CacheUserHandler extends EventHandler<Events.MessageCreate> {
  constructor(private readonly cacheService: CacheService) {
    super();
  }

  readonly eventType = Events.MessageCreate;

  async handle(msg: Message): Promise<void> {
    if (msg.author.bot) {
      return;
    }
    await this.cacheService.cacheUser({
      id: BigInt(msg.author.id),
      name: msg.author.username,
      discriminator: parseInt(msg.author.discriminator, 10),
      avatarUrl: msg.author.displayAvatarURL(),
      lastChecked: new Date(),
    });
  }
}
