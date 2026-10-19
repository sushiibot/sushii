import { Events } from "discord.js";
import type { GuildMember } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import logger from "@/shared/infrastructure/logger";

import type { CachedGuildRepository } from "../../domain";

export class CacheMemberAddHandler extends EventHandler<Events.GuildMemberAdd> {
  constructor(private readonly guildRepository: CachedGuildRepository) {
    super();
  }

  readonly eventType = Events.GuildMemberAdd;

  async handle(member: GuildMember): Promise<void> {
    const updated = await this.guildRepository.incrementMemberCount(
      BigInt(member.guild.id),
    );

    if (!updated) {
      logger.warn(
        { guildId: member.guild.id, userId: member.user.id },
        "Guild not in cache, skipped member count increment",
      );
    }
  }
}

export class CacheMemberRemoveHandler extends EventHandler<Events.GuildMemberRemove> {
  constructor(private readonly guildRepository: CachedGuildRepository) {
    super();
  }

  readonly eventType = Events.GuildMemberRemove;

  async handle(member: GuildMember): Promise<void> {
    const updated = await this.guildRepository.decrementMemberCount(
      BigInt(member.guild.id),
    );

    if (!updated) {
      logger.warn(
        { guildId: member.guild.id, userId: member.user.id },
        "Guild not in cache, skipped member count decrement",
      );
    }
  }
}
