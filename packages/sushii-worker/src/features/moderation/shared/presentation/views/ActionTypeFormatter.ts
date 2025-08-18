import type { BotEmojiName } from "@/features/bot-emojis/domain";
import Color from "@/utils/colors";
import toSentenceCase from "@/utils/toSentenceCase";

import type { ActionTypeBotEmojis } from "../../domain/value-objects/ActionType";
import { ActionType } from "../../domain/value-objects/ActionType";

export function formatActionType(action: ActionType): string {
  switch (action) {
    case ActionType.Ban:
      return "ban";
    case ActionType.TempBan:
      return "temporary ban";
    case ActionType.BanRemove:
      return "unban";
    case ActionType.Kick:
      return "kick";
    case ActionType.Timeout:
      return "timeout";
    case ActionType.TimeoutRemove:
      return "timeout remove";
    case ActionType.TimeoutAdjust:
      return "timeout adjust";
    case ActionType.Warn:
      return "warn";
    case ActionType.Note:
      return "note";
    case ActionType.History:
      return "history";
    case ActionType.Lookup:
      return "lookup";
  }
}

export function formatActionTypeAsSentence(action: ActionType): string {
  return toSentenceCase(formatActionType(action));
}

export function formatActionTypeAsPresentTense(action: ActionType): string {
  switch (action) {
    case ActionType.Ban:
      return "banning";
    case ActionType.TempBan:
      return "temporarily banning";
    case ActionType.BanRemove:
      return "unbanning";
    case ActionType.Kick:
      return "kicking";
    case ActionType.Timeout:
      return "timing out";
    case ActionType.TimeoutRemove:
      return "removing time out for";
    case ActionType.TimeoutAdjust:
      return "changing timeout duration for";
    case ActionType.Warn:
      return "warning";
    case ActionType.Note:
      return "adding note for";
    case ActionType.History:
      return "getting history for";
    case ActionType.Lookup:
      return "looking up";
  }
}

export function formatActionTypeAsPastTense(action: ActionType): string {
  switch (action) {
    case ActionType.Ban:
      return "banned";
    case ActionType.TempBan:
      return "temporarily banned";
    case ActionType.BanRemove:
      return "unbanned";
    case ActionType.Kick:
      return "kicked";
    case ActionType.Timeout:
      return "timed out";
    case ActionType.TimeoutRemove:
      return "timeout removed for";
    case ActionType.TimeoutAdjust:
      return "changed timeout duration for";
    case ActionType.Warn:
      return "warned";
    case ActionType.Note:
      return "added note for";
    case ActionType.History:
      return "got history for";
    case ActionType.Lookup:
      return "looked up";
  }
}

export function getActionTypeBotEmoji(
  action: ActionType,
): (typeof ActionTypeBotEmojis)[number] {
  switch (action) {
    case ActionType.Ban:
      return "ban";
    case ActionType.TempBan:
      return "tempban";
    case ActionType.BanRemove:
      return "unban";
    case ActionType.Kick:
      return "kick";
    case ActionType.Timeout:
    case ActionType.TimeoutAdjust:
      return "timeout";
    case ActionType.TimeoutRemove:
      return "untimeout";
    case ActionType.Warn:
      return "warn";
    case ActionType.Note:
      return "note";
    case ActionType.History:
      return "history";
    case ActionType.Lookup:
      return "lookup";
  }
}

/**
 *
 * @deprecated Use getActionTypeBotEmoji now
 */
export function getActionTypeEmoji(action: ActionType): string {
  switch (action) {
    case ActionType.Ban:
      return "🔨";
    case ActionType.TempBan:
      return "⏳";
    case ActionType.BanRemove:
      return "🔓";
    case ActionType.Kick:
      return "👢";
    case ActionType.Timeout:
      return "🔇";
    case ActionType.TimeoutRemove:
      return "🔉";
    case ActionType.TimeoutAdjust:
      return "⏲️";
    case ActionType.Warn:
      return "⚠️";
    case ActionType.Note:
      return "📝";
    case ActionType.History:
      return "📜";
    case ActionType.Lookup:
      return "🔍";
  }
}

export function getActionTypeColor(actionType: ActionType): Color | null {
  switch (actionType) {
    case ActionType.Ban:
      return Color.Error;
    case ActionType.TempBan:
      return Color.Purple;
    case ActionType.BanRemove:
      return Color.Success;
    case ActionType.Kick:
    case ActionType.Warn:
    case ActionType.Timeout:
      return Color.Warning;
    case ActionType.TimeoutAdjust:
    case ActionType.TimeoutRemove:
    case ActionType.Note:
      return Color.Info;
    default:
      return null;
  }
}
