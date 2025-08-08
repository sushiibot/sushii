import type { Result } from "ts-results";

import type { ModerationCase } from "../entities/ModerationCase";
import type { ModerationTarget } from "../entities/ModerationTarget";
import type { ActionType } from "../value-objects/ActionType";

/**
 * Domain service for posting moderation logs to guild channels.
 * Handles the posting of Warn/Note actions to configured mod log channels.
 */
export interface ModLogService {
  /**
   * Posts a moderation action to the guild's configured mod log channel.
   *
   * @param guildId - The guild ID where the action occurred
   * @param actionType - The type of moderation action
   * @param target - The target user of the moderation action
   * @param moderationCase - The moderation case to post
   * @returns Result indicating success or failure
   */
  sendModLog(
    guildId: string,
    actionType: ActionType,
    target: ModerationTarget,
    moderationCase: ModerationCase,
  ): Promise<Result<void, string>>;

  /**
   * Checks if the given action type should be posted to mod log channels.
   * Currently applies to Warn and Note actions.
   *
   * @param actionType - The action type to check
   * @returns true if the action should be posted to mod log
   */
  shouldPostToModLog(actionType: ActionType): boolean;
}
