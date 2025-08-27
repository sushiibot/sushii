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
    const result = await this.guildRepository.incrementMemberCount(
      BigInt(member.guild.id),
    );

    if (result.err) {
      logger.error(
        { err: result.val, guildId: member.guild.id, userId: member.user.id },
        "Failed to increment member count",
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
    const result = await this.guildRepository.decrementMemberCount(
      BigInt(member.guild.id),
    );

    if (result.err) {
      logger.error(
        { err: result.val, guildId: member.guild.id, userId: member.user.id },
        "Failed to decrement member count",
      );
    }
  }
}
