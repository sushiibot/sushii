import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { ModerationAction } from "../../shared/domain/entities/ModerationAction";
import type { ModerationTarget } from "../../shared/domain/entities/ModerationTarget";
import {
  ActionType,
  actionTypeSupportsDM,
} from "../../shared/domain/value-objects/ActionType";

export class DMPolicyService {
  constructor(private readonly guildConfigRepository: GuildConfigRepository) {}

  async shouldSendDM(
    timing: "before" | "after",
    action: ModerationAction,
    target: ModerationTarget,
    guildId: string,
  ): Promise<boolean> {
    // Basic eligibility - only DM users who are in the server and for supported actions
    if (!target.member || !actionTypeSupportsDM(action.actionType)) {
      return false;
    }

    // Timing rules - bans DM before action, others DM after
    if (timing === "before" && !action.isBanOrTempBanAction()) {
      // Not ban action, never DM before action
      return false;
    }

    if (timing === "after" && action.isBanOrTempBanAction()) {
      // Is ban action, never DM after action
      return false;
    }

    // Don't DM if no reason provided
    if (!action.reason) {
      return false;
    }

    // Warn ALWAYS DMs, cannot disable or override
    if (action.actionType === ActionType.Warn) {
      return true;
    }

    // Command-level DM choice override takes highest priority
    if (action.dmChoice !== "unspecified") {
      // Needs explicit yes
      return action.dmChoice === "yes_dm";
    }

    // Action-specific rules
    if (action.actionType === ActionType.BanRemove) {
      // Unban never sends DM (user not in server)
      return false;
    }

    // No override, check guild-specific settings
    return this.shouldSendDMForGuildSettings(guildId, action.actionType);
  }

  private async shouldSendDMForGuildSettings(
    guildId: string,
    actionType: ActionType,
  ): Promise<boolean> {
    const guildConfig = await this.guildConfigRepository.findByGuildId(guildId);

    switch (actionType) {
      case ActionType.Ban:
      case ActionType.TempBan:
        return guildConfig.moderationSettings.banDmEnabled;
      case ActionType.Timeout:
        return guildConfig.moderationSettings.timeoutCommandDmEnabled;
      default:
        return true;
    }
  }
}
