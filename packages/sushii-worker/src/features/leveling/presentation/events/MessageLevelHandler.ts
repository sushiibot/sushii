import type { Span } from "@opentelemetry/api";
import opentelemetry from "@opentelemetry/api";
import type { Message } from "discord.js";
import { DiscordAPIError, Events, RESTJSONErrorCodes } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import { newModuleLogger } from "@/shared/infrastructure/logger";

import type { UpdateUserXpService } from "../../application/UpdateUserXpService";

const tracer = opentelemetry.trace.getTracer("message-level-handler");
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

    const result = await tracer.startActiveSpan(
      "updateUserXp",
      async (span: Span) => {
        try {
          return await this.updateUserXpService.execute(
            msg.guildId,
            msg.channelId,
            msg.author.id,
            msg.member?.roles.cache.map((r) => r.id) || [],
          );
        } finally {
          span.end();
        }
      },
    );

    if (!result || result.oldLevel === null || result.newLevel === null) {
      return;
    }

    const { addRoleIds, removeRoleIds } = result;

    if (
      (!addRoleIds || addRoleIds.length === 0) &&
      (!removeRoleIds || removeRoleIds.length === 0)
    ) {
      return;
    }

    const newRoles = new Set(msg.member.roles.cache.keys() || []);

    if (addRoleIds) {
      for (const roleId of addRoleIds) {
        newRoles.add(roleId);
      }
    }

    if (removeRoleIds) {
      for (const roleId of removeRoleIds) {
        newRoles.delete(roleId);
      }
    }

    const noRoleChanges =
      newRoles.size === msg.member.roles.cache.size &&
      msg.member.roles.cache.every((r) => newRoles.has(r.id));

    if (noRoleChanges) {
      return;
    }

    await tracer.startActiveSpan("update_member_roles", async (span) => {
      try {
        if (!msg.member) {
          throw new Error("Member not found for message");
        }

        await msg.member.roles.set(
          [...newRoles],
          `Level role ${result.newLevel}`,
        );
      } catch (err) {
        if (err instanceof DiscordAPIError) {
          if (err.code === RESTJSONErrorCodes.MissingPermissions) {
            log.warn(
              {
                guildId: msg.guildId,
                channelId: msg.channelId,
                userId: msg.author.id,
                err,
              },
              "Missing permissions to update member roles",
            );
          }
        }

        log.warn(
          {
            guildId: msg.guildId,
            channelId: msg.channelId,
            userId: msg.author.id,
            err,
          },
          "Failed to update member roles",
        );
      } finally {
        span.end();
      }
    });

    log.debug(
      {
        guildId: msg.guildId,
        channelId: msg.channelId,
        userId: msg.author.id,
        oldLevel: result.oldLevel,
        newLevel: result.newLevel,
        addRoleIds,
        removeRoleIds,
        newMemberRoles: [...newRoles],
      },
      "Level role update",
    );
  }
}
