import { type AutoModerationActionExecution, AutoModerationActionType, Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { AutomodAlertCache } from "../../application/AutomodAlertCache";

/**
 * Listens for native Discord AutoMod action executions and tracks alert messages
 * in the AutomodAlertCache so mods can see reactions when actions are taken.
 */
export class AutomodAlertExecutionHandler extends EventHandler<Events.AutoModerationActionExecution> {
  readonly eventType = Events.AutoModerationActionExecution;

  constructor(
    private readonly cache: AutomodAlertCache,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handle(execution: AutoModerationActionExecution): Promise<void> {
    if (execution.action.type !== AutoModerationActionType.SendAlertMessage) {
      return;
    }

    if (!execution.alertSystemMessageId) return;

    const channelId = execution.action.metadata?.channelId;
    if (!channelId) return;

    this.cache.track(
      execution.guild.id,
      execution.userId,
      execution.alertSystemMessageId,
      channelId,
    );

    this.logger.debug(
      {
        guildId: execution.guild.id,
        userId: execution.userId,
        messageId: execution.alertSystemMessageId,
        channelId,
      },
      "Tracked native AutoMod alert message",
    );
  }
}
