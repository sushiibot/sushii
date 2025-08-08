import type { GuildMember, User } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { PermissionValidationService } from "../../domain/services/PermissionValidationService";
import { ActionType } from "../../domain/value-objects/ActionType";

/**
 * Discord.js implementation of permission validation service.
 * Extracted from legacy hasPermissionTargetingMember function.
 */
export class DiscordPermissionValidationService
  implements PermissionValidationService
{
  async canTargetUser(
    executor: User,
    executorMember: GuildMember | null,
    target: User,
    targetMember: GuildMember | null,
    actionType: ActionType,
  ): Promise<Result<void, string>> {
    // If target is not in guild, allow action (for Note actions on non-members)
    if (!targetMember || !executorMember) {
      return Ok.EMPTY;
    }

    // Cannot target self
    if (target.id === executor.id) {
      return Err("You cannot target yourself");
    }

    // Executor is owner, always allowed
    if (executor.id === executorMember.guild.ownerId) {
      return Ok.EMPTY;
    }

    // Cannot target owner
    if (target.id === executorMember.guild.ownerId) {
      return Err("You cannot target the owner");
    }

    // Check role hierarchy
    const roleResult = this.hasHigherRole(executorMember, targetMember);
    if (!roleResult.ok) {
      return roleResult;
    }

    // Check Discord permissions
    const permissionResult = this.hasRequiredPermissions(
      executorMember,
      actionType,
    );
    if (!permissionResult.ok) {
      return permissionResult;
    }

    return Ok.EMPTY;
  }

  hasRequiredPermissions(
    executorMember: GuildMember,
    actionType: ActionType,
  ): Result<void, string> {
    const permissions = executorMember.permissions;

    switch (actionType) {
      case ActionType.Ban:
      case ActionType.TempBan:
      case ActionType.BanRemove:
        if (!permissions.has(PermissionFlagsBits.BanMembers)) {
          return Err(
            "You need the 'Ban Members' permission to perform this action",
          );
        }
        break;

      case ActionType.Kick:
        if (!permissions.has(PermissionFlagsBits.KickMembers)) {
          return Err(
            "You need the 'Kick Members' permission to perform this action",
          );
        }
        break;

      case ActionType.Timeout:
      case ActionType.TimeoutAdjust:
      case ActionType.TimeoutRemove:
        if (!permissions.has(PermissionFlagsBits.ModerateMembers)) {
          return Err(
            "You need the 'Timeout Members' permission to perform this action",
          );
        }
        break;

      case ActionType.Warn:
      case ActionType.Note:
        // These typically don't require special Discord permissions beyond basic moderation
        // Permission check can be guild-specific via role configuration
        break;

      default:
        // For unknown action types, allow but log
        break;
    }

    return Ok.EMPTY;
  }

  hasHigherRole(
    executorMember: GuildMember,
    targetMember: GuildMember,
  ): Result<void, string> {
    // Default 0 for @everyone role position
    const executorRolePosition = executorMember.roles.highest.position;
    const targetRolePosition = targetMember.roles.highest.position;

    // Target highest role must be lower than executor role
    if (targetRolePosition < executorRolePosition) {
      return Ok.EMPTY;
    }

    if (targetRolePosition === executorRolePosition) {
      return Err(
        "You cannot target a member with the same highest role as you",
      );
    }

    return Err("You cannot target a member with a higher role than you");
  }
}
