import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { DMIntentSource } from "../../shared/domain/entities/ModerationCase";
import type { ModerationAction } from "../../shared/domain/entities/ModerationAction";
import type { ModerationTarget } from "../../shared/domain/entities/ModerationTarget";
import {
  ActionType,
  actionTypeSupportsDM,
} from "../../shared/domain/value-objects/ActionType";

export interface DMPolicyDecision {
  should: boolean;
  source: DMIntentSource;
}

export class DMPolicyService {
  constructor(private readonly guildConfigRepository: GuildConfigRepository) {}

  async shouldSendDM(
    timing: "before" | "after",
    action: ModerationAction,
    target: ModerationTarget,
    guildId: string,
  ): Promise<DMPolicyDecision> {
    // Basic eligibility - only DM users who are in the server and for supported actions
    if (!target.member) {
      return { should: false, source: 'action_not_supported' };
    }
    
    if (!actionTypeSupportsDM(action.actionType)) {
      return { should: false, source: 'action_not_supported' };
    }

    // Timing rules - bans DM before action, others DM after
    if (timing === "before" && !action.isBanOrTempBanAction()) {
      // Not ban action, never DM before action
      return { should: false, source: 'action_not_supported' };
    }

    if (timing === "after" && action.isBanOrTempBanAction()) {
      // Is ban action, never DM after action
      return { should: false, source: 'action_not_supported' };
    }

    // Don't DM if no reason provided
    if (!action.reason) {
      return { should: false, source: 'action_not_supported' };
    }

    // Warn ALWAYS DMs, cannot disable or override
    if (action.actionType === ActionType.Warn) {
      return { should: true, source: 'warn_always' };
    }

    // Command-level DM choice override takes highest priority
    if (action.dmChoice !== "unspecified") {
      // Needs explicit yes
      return {
        should: action.dmChoice === "yes_dm",
        source: action.dmChoice === "yes_dm" ? 'executor_yes' : 'executor_no'
      };
    }

    // Action-specific rules
    if (action.actionType === ActionType.BanRemove) {
      // Unban never sends DM (user not in server)
      return { should: false, source: 'action_not_supported' };
    }

    // No override, check guild-specific settings
    const shouldSend = await this.shouldSendDMForGuildSettings(guildId, action.actionType);
    return { should: shouldSend, source: 'guild_default' };
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
