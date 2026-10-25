import type { Message } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import { newModuleLogger } from "@/shared/infrastructure/logger";

import type { UpdateUserXpService } from "../../application/UpdateUserXpService";
import { applyLevelRoles } from "./applyLevelRoles";

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

    await applyLevelRoles(
      msg.member,
      result.newLevel,
      result.addRoleIds,
      result.removeRoleIds,
      { channelId: msg.channelId, oldLevel: result.oldLevel },
    );
  }
}
