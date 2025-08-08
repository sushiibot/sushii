import type { GuildMember, User } from "discord.js";
import type { Result } from "ts-results";

import type { ActionType } from "../value-objects/ActionType";

/**
 * Domain service for validating moderation permissions.
 * Ensures that the executor has permission to perform the action on the target.
 */
export interface PermissionValidationService {
  /**
   * Validates that the executor can perform the given action on the target user.
   *
   * @param executor - The user executing the moderation action
   * @param executorMember - The executor's guild member object (if in guild)
   * @param target - The target user of the moderation action
   * @param targetMember - The target's guild member object (if in guild)
   * @param actionType - The type of moderation action being performed
   * @returns Result indicating success or failure with error message
   */
  canTargetUser(
    executor: User,
    executorMember: GuildMember | null,
    target: User,
    targetMember: GuildMember | null,
    actionType: ActionType,
  ): Promise<Result<void, string>>;

  /**
   * Validates that the executor has the required Discord permissions for the action.
   *
   * @param executorMember - The executor's guild member object
   * @param actionType - The type of moderation action being performed
   * @returns Result indicating success or failure with error message
   */
  hasRequiredPermissions(
    executorMember: GuildMember,
    actionType: ActionType,
  ): Result<void, string>;

  /**
   * Validates role hierarchy - executor must have higher role than target.
   *
   * @param executorMember - The executor's guild member object
   * @param targetMember - The target's guild member object
   * @returns Result indicating success or failure with error message
   */
  hasHigherRole(
    executorMember: GuildMember,
    targetMember: GuildMember,
  ): Result<void, string>;
}
