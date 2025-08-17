import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { ModerationAction } from "../../shared/domain/entities/ModerationAction";
import type { DMIntentSource } from "../../shared/domain/entities/ModerationCase";
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
    guildConfig: GuildConfig,
  ): Promise<DMPolicyDecision> {
    // Basic eligibility - only DM users who are in the server and for supported actions
    if (!target.member) {
      return { should: false, source: "action_not_supported" };
    }

    if (!actionTypeSupportsDM(action.actionType)) {
      return { should: false, source: "action_not_supported" };
    }

    // Timing rules - bans/kicks DM before action, others DM after
    // Don't DM if no reason provided AND no custom DM text configured
    const hasCustomText = this.hasCustomDMText(action.actionType, guildConfig);
    if (!action.reason && !hasCustomText) {
      return { should: false, source: "action_not_supported" };
    }

    // Warn ALWAYS DMs, cannot disable or override, regardless of timing
    if (action.actionType === ActionType.Warn) {
      return { should: true, source: "warn_always" };
    }

    if (timing === "before" && !action.shouldSendDMBeforeAction()) {
      // Not a pre-action DM type, never DM before action
      return { should: false, source: "action_not_supported" };
    }

    if (timing === "after" && action.shouldSendDMBeforeAction()) {
      // Is pre-action DM type, never DM after action
      return { should: false, source: "action_not_supported" };
    }

    // Command-level DM choice override takes highest priority
    if (action.dmChoice !== "unspecified") {
      // Needs explicit yes
      return {
        should: action.dmChoice === "yes_dm",
        source: action.dmChoice === "yes_dm" ? "executor_yes" : "executor_no",
      };
    }

    // Action-specific rules
    if (action.actionType === ActionType.BanRemove) {
      // Unban never sends DM (user not in server)
      return { should: false, source: "action_not_supported" };
    }

    // No override, check guild-specific settings
    const shouldSend = this.shouldSendDMForGuildSettings(
      guildConfig,
      action.actionType,
    );
    return { should: shouldSend, source: "guild_default" };
  }

  private shouldSendDMForGuildSettings(
    guildConfig: GuildConfig,
    actionType: ActionType,
  ): boolean {
    switch (actionType) {
      case ActionType.Ban:
      case ActionType.TempBan:
        return guildConfig.moderationSettings.banDmEnabled;
      case ActionType.Kick:
        // TODO: Add kickDmEnabled config option
        // For now, default to false since there's no config option yet
        return false;
      case ActionType.Timeout:
        return guildConfig.moderationSettings.timeoutCommandDmEnabled;
      default:
        return true;
    }
  }

  private hasCustomDMText(
    actionType: ActionType,
    guildConfig: GuildConfig,
  ): boolean {
    switch (actionType) {
      case ActionType.Ban:
      case ActionType.TempBan:
        return !!guildConfig.moderationSettings.banDmText;
      case ActionType.Timeout:
        return !!guildConfig.moderationSettings.timeoutDmText;
      case ActionType.Warn:
        return !!guildConfig.moderationSettings.warnDmText;
      default:
        return false;
    }
  }
}
