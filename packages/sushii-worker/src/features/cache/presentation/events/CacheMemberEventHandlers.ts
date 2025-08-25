import opentelemetry from "@opentelemetry/api";
import { Events } from "discord.js";
import type { GuildMember } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import logger from "@/shared/infrastructure/logger";

import type { CachedGuildRepository } from "../../domain";

const tracer = opentelemetry.trace.getTracer("cache-member-handler");

export class CacheMemberAddHandler extends EventHandler<Events.GuildMemberAdd> {
  constructor(private readonly guildRepository: CachedGuildRepository) {
    super();
  }

  readonly eventType = Events.GuildMemberAdd;

  async handle(member: GuildMember): Promise<void> {
    const span = tracer.startSpan("member add cache update");

    try {
      const result = await this.guildRepository.incrementMemberCount(
        BigInt(member.guild.id),
      );

      if (result.err) {
        logger.error(
          { err: result.val, guildId: member.guild.id, userId: member.user.id },
          "Failed to increment member count",
        );
      }
    } finally {
      span.end();
    }
  }
}

export class CacheMemberRemoveHandler extends EventHandler<Events.GuildMemberRemove> {
  constructor(private readonly guildRepository: CachedGuildRepository) {
    super();
  }

  readonly eventType = Events.GuildMemberRemove;

  async handle(member: GuildMember): Promise<void> {
    const span = tracer.startSpan("member remove cache update");

    try {
      const result = await this.guildRepository.decrementMemberCount(
        BigInt(member.guild.id),
      );

      if (result.err) {
        logger.error(
          { err: result.val, guildId: member.guild.id, userId: member.user.id },
          "Failed to decrement member count",
        );
      }
    } finally {
      span.end();
    }
  }
}
