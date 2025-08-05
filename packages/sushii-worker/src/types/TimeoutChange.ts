import dayjs, { Dayjs } from "dayjs";
import { Duration } from "dayjs/plugin/duration";
import { GuildAuditLogsEntry } from "discord.js";

import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import logger from "@/shared/infrastructure/logger";

import { findTimeoutChange } from "./ModLogEventData";

export type TimeoutChange =
  | {
      actionType: ActionType.TimeoutRemove;
      old: Dayjs;
      new: undefined;
    }
  | {
      actionType: ActionType.Timeout;
      old: undefined;
      new: Dayjs;
      duration: Duration;
    }
  | {
      actionType: ActionType.TimeoutAdjust;
      old: Dayjs;
      new: Dayjs;
      duration: Duration;
    };

export function getTimeoutChangeData(
  event: GuildAuditLogsEntry,
): TimeoutChange | undefined {
  const timeoutChange = findTimeoutChange(event.changes);
  if (!timeoutChange) {
    return;
  }

  if (
    (timeoutChange.new !== undefined &&
      typeof timeoutChange.new !== "string") ||
    (timeoutChange.old !== undefined && typeof timeoutChange.old !== "string")
  ) {
    logger.error(
      {
        timeoutChange,
      },
      "Mismatch audit log change type",
    );

    return;
  }

  const now = dayjs.utc();

  // Check if old_value is in the past. Timeout timestamps persist in the
  // member object even after the timeout has expired. If the old_value is
  // in the past, it's a new timeout.
  // Reset old_value to reflect accurate change
  if (dayjs(timeoutChange.old).isBefore(now)) {
    timeoutChange.old = undefined;
  }

  // New Timeout - null -> timeout
  // "changes": [
  //   {
  //     "key": "communication_disabled_until",
  //     "new_value": "2023-01-21T21:33:52.129000+00:00"
  //   }
  // ]
  if (!timeoutChange.old && timeoutChange.new) {
    const newDate = dayjs(timeoutChange.new);

    return {
      actionType: ActionType.Timeout,
      old: undefined,
      new: newDate,
      duration: dayjs.duration(newDate.diff(now)),
    };
  }

  // Timeout Removed - timeout -> null
  // "changes": [
  //   {
  //     "key": "communication_disabled_until",
  //     "old_value": "2023-01-21T21:33:52.129000+00:00"
  //   }
  // ]
  if (timeoutChange.old && !timeoutChange.new) {
    return {
      actionType: ActionType.TimeoutRemove,
      old: dayjs.utc(timeoutChange.old),
      new: undefined,
    };
  }

  // Timeout changed - old and new should exist and be different
  if (
    timeoutChange.old &&
    timeoutChange.new &&
    timeoutChange.old !== timeoutChange.new
  ) {
    // Old is not in the past, it's an adjustment. old_value is checked
    // earlier in the function to ensure this is a new timeout adjustment.
    const old = dayjs.utc(timeoutChange.old);
    const newDate = dayjs(timeoutChange.new);
    const duration = dayjs.duration(newDate.diff(old));

    return {
      actionType: ActionType.TimeoutAdjust,
      new: dayjs.utc(timeoutChange.new),
      old,
      duration,
    };
  }
}
