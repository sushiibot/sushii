import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
import type { GuildMember } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

const tracer = opentelemetry.trace.getTracer("member-events");

import type {
  JoinLeaveMessageService,
  MemberLogService,
} from "../../application";

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
    await tracer.startActiveSpan("member-events.join", async (span) => {
      span.setAttributes({
        "guild.id": member.guild.id,
        "user.id": member.user.id,
      });
      try {
        const results = await Promise.allSettled([
          this.memberLogService.logMemberJoin(member),
          this.joinLeaveMessageService.sendJoinMessage(member),
        ]);

        const rejected = results.filter((r) => r.status === "rejected");
        if (rejected.length > 0) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          for (const r of rejected) {
            const err = (r as PromiseRejectedResult).reason;
            span.recordException(err instanceof Error ? err : new Error(String(err)));
            this.logger.error(
              { err, guildId: member.guild.id, userId: member.user.id },
              "Error in member join handler",
            );
          }
        }
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        this.logger.error(
          { err: error, guildId: member.guild.id, userId: member.user.id },
          "Unexpected error in member join handler",
        );
      } finally {
        span.end();
      }
    });
  }
}
