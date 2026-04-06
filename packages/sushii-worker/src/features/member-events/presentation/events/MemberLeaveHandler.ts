import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
import type { GuildMember, PartialGuildMember } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

const tracer = opentelemetry.trace.getTracer("member-events");

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
    await tracer.startActiveSpan("member-events.leave", async (span) => {
      span.setAttributes({
        "guild.id": member.guild.id,
        "user.id": member.user?.id ?? "unknown",
      });
      try {
        await Promise.allSettled([
          this.memberLogService.logMemberLeave(member),
          this.joinLeaveMessageService.sendLeaveMessage(member),
        ]);
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        this.logger.error(
          { err: error, guildId: member.guild.id, userId: member.user?.id },
          "Unexpected error in member leave handler",
        );
      } finally {
        span.end();
      }
    });
  }
}
