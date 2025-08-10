import type { GuildMember } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { JoinLeaveMessageService, MemberLogService } from "../../application";

export class MemberJoinHandler extends EventHandler<Events.GuildMemberAdd> {
  constructor(
    private readonly memberLogService: MemberLogService,
    private readonly joinLeaveMessageService: JoinLeaveMessageService,
    private readonly logger: Logger,
  ) {
    super();
  }

  readonly eventType = Events.GuildMemberAdd;

  async handle(member: GuildMember): Promise<void> {
    try {
      // Run both services in parallel
      await Promise.allSettled([
        this.memberLogService.logMemberJoin(member),
        this.joinLeaveMessageService.sendJoinMessage(member),
      ]);
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId: member.guild.id,
          userId: member.user.id,
        },
        "Unexpected error in member join handler",
      );
    }
  }
}