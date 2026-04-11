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

  // Always track alerts regardless of which slot is active. The cache is
  // in-memory and slot-local, so if tracking were gated on the active slot,
  // a switchover between the AutoMod alert and the mod action audit log would
  // leave the incoming active slot with an empty cache and no reaction fires.
  readonly isExemptFromDeploymentCheck = true;

  constructor(
    private readonly cache: AutomodAlertCache,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handle(execution: AutoModerationActionExecution): Promise<void> {
    this.logger.debug(
      {
        guildId: execution.guild.id,
        userId: execution.userId,
        actionType: execution.action.type,
        alertSystemMessageId: execution.alertSystemMessageId,
        channelId: execution.action.metadata?.channelId,
      },
      "AutoModerationActionExecution received",
    );

    if (execution.action.type !== AutoModerationActionType.SendAlertMessage) {
      return;
    }

    if (!execution.alertSystemMessageId) {
      this.logger.debug(
        { guildId: execution.guild.id, userId: execution.userId },
        "AutoMod alert execution has no alertSystemMessageId, skipping",
      );
      return;
    }

    const channelId = execution.action.metadata?.channelId;
    if (!channelId) {
      this.logger.debug(
        { guildId: execution.guild.id, userId: execution.userId },
        "AutoMod alert execution has no channelId in metadata, skipping",
      );
      return;
    }

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
