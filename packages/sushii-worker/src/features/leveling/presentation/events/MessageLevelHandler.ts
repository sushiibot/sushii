import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
import type { Message } from "discord.js";
import { DiscordAPIError, Events, RESTJSONErrorCodes } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import { newModuleLogger } from "@/shared/infrastructure/logger";

import type { UpdateUserXpService } from "../../application/UpdateUserXpService";
import { computeLevelRoleDiff } from "./levelRoleDiff";

const tracer = opentelemetry.trace.getTracer("leveling");
const log = newModuleLogger("messageLevelHandler");

export class MessageLevelHandler extends EventHandler<Events.MessageCreate> {
  constructor(private readonly updateUserXpService: UpdateUserXpService) {
    super();
  }

  readonly eventType = Events.MessageCreate;

  async handle(msg: Message): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    if (msg.author.bot) {
      return;
    }

    if (!msg.member) {
      log.warn(msg, "No member found for message");
      return;
    }

    const result = await this.updateUserXpService.execute(
      msg.guildId,
      msg.channelId,
      msg.author.id,
      msg.member?.roles.cache.map((r) => r.id) || [],
    );

    if (!result || result.oldLevel === null || result.newLevel === null) {
      return;
    }

    const { addRoleIds, removeRoleIds } = result;
    const member = msg.member;

    // Apply only the diff with single-role add/remove requests. Array forms of
    // roles.add/remove (and roles.set) send the full role list computed from a
    // possibly stale cache, which can revert concurrent role changes.
    const { toAdd, toRemove } = computeLevelRoleDiff(
      member.roles.cache.keys(),
      addRoleIds,
      removeRoleIds,
    );

    if (toAdd.length === 0 && toRemove.length === 0) {
      return;
    }

    const logContext = {
      guildId: msg.guildId,
      channelId: msg.channelId,
      userId: msg.author.id,
      oldLevel: result.oldLevel,
      newLevel: result.newLevel,
      addRoleIds: toAdd,
      removeRoleIds: toRemove,
    };

    await tracer.startActiveSpan("leveling.roles.update", async (span) => {
      try {
        const reason = `Level role ${result.newLevel}`;

        for (const roleId of toAdd) {
          await member.roles.add(roleId, reason);
        }

        for (const roleId of toRemove) {
          await member.roles.remove(roleId, reason);
        }

        log.debug(logContext, "Level role update");
      } catch (err) {
        span.recordException(
          err instanceof Error ? err : new Error(String(err)),
        );
        span.setStatus({ code: SpanStatusCode.ERROR });

        const message =
          err instanceof DiscordAPIError &&
          err.code === RESTJSONErrorCodes.MissingPermissions
            ? "Missing permissions to update member roles"
            : "Failed to update member roles";

        log.warn({ ...logContext, err }, message);
      } finally {
        span.end();
      }
    });
  }
}
