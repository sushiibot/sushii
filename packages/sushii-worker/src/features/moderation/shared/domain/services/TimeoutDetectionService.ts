import dayjs from "@/shared/domain/dayjs";

import type { ModerationTarget } from "../entities/ModerationTarget";
import { ActionType } from "../value-objects/ActionType";

/**
 * Domain service for detecting timeout states and determining the correct action type.
 * Based on legacy logic from executeAction.ts lines 361-376.
 */
export class TimeoutDetectionService {
  /**
   * Determines if a timeout action should be logged as TimeoutAdjust instead of Timeout.
   * This happens when the target member already has an active timeout.
   *
   * @param incomingActionType - The original action type requested
   * @param target - The target user/member
   * @returns The corrected action type (TimeoutAdjust if adjustment, original otherwise)
   */
  determineTimeoutActionType(
    incomingActionType: ActionType,
    target: ModerationTarget,
  ): ActionType {
    // Only applies to Timeout actions
    if (incomingActionType !== ActionType.Timeout) {
      return incomingActionType;
    }

    // Only applies to members in the guild
    if (!target.member) {
      return incomingActionType;
    }

    // Check if member is already timed out
    const communicationDisabledUntil = dayjs.utc(
      target.member.communicationDisabledUntil,
    );

    // This is the current timeout **before** applying the new one
    // If there is a timeout that hasn't expired yet, then this is an adjustment
    const isTimeoutAdjust =
      communicationDisabledUntil.isValid() &&
      communicationDisabledUntil.isAfter(dayjs.utc());

    return isTimeoutAdjust ? ActionType.TimeoutAdjust : ActionType.Timeout;
  }

  /**
   * Checks if a member currently has an active timeout.
   *
   * @param target - The target user/member
   * @returns true if the member has an active timeout
   */
  hasActiveTimeout(target: ModerationTarget): boolean {
    if (!target.member) {
      return false;
    }

    const communicationDisabledUntil = dayjs.utc(
      target.member.communicationDisabledUntil,
    );

    return (
      communicationDisabledUntil.isValid() &&
      communicationDisabledUntil.isAfter(dayjs.utc())
    );
  }

  /**
   * Gets the current timeout expiration time for a member.
   *
   * @param target - The target user/member
   * @returns dayjs object of expiration time, or null if no active timeout
   */
  getCurrentTimeoutExpiration(target: ModerationTarget): dayjs.Dayjs | null {
    if (!target.member) {
      return null;
    }

    const communicationDisabledUntil = dayjs.utc(
      target.member.communicationDisabledUntil,
    );

    if (
      communicationDisabledUntil.isValid() &&
      communicationDisabledUntil.isAfter(dayjs.utc())
    ) {
      return communicationDisabledUntil;
    }

    return null;
  }
}
