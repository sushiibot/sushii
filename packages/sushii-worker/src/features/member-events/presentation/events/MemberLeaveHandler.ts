import type { GuildMember, PartialGuildMember } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type {
  JoinLeaveMessageService,
  MemberLogService,
} from "../../application";

export class MemberLeaveHandler extends EventHandler<Events.GuildMemberRemove> {
  constructor(
    private readonly memberLogService: MemberLogService,
    private readonly joinLeaveMessageService: JoinLeaveMessageService,
    private readonly logger: Logger,
  ) {
    super();
  }

  readonly eventType = Events.GuildMemberRemove;

  async handle(member: GuildMember | PartialGuildMember): Promise<void> {
    try {
      // Run both services in parallel
      await Promise.allSettled([
        this.memberLogService.logMemberLeave(member),
        this.joinLeaveMessageService.sendLeaveMessage(member),
      ]);
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId: member.guild.id,
          userId: member.user.id,
        },
        "Unexpected error in member leave handler",
      );
    }
  }
}
