import type { BotEmojiNameType } from "@/features/bot-emojis";
import type { PermissionName } from "@/features/permission-audit";

export enum ActionType {
  Ban = "ban",
  TempBan = "temp_ban",
  BanRemove = "unban",
  Softban = "softban",
  Kick = "kick",
  Timeout = "timeout",
  TimeoutRemove = "timeout_remove",
  TimeoutAdjust = "timeout_adjust",
  Warn = "warn",
  Note = "note",
  History = "history",
  Lookup = "lookup",
}

// Domain business rules only
export function actionTypeRequiresDiscordAction(action: ActionType): boolean {
  return [
    ActionType.Ban,
    ActionType.TempBan,
    ActionType.BanRemove,
    ActionType.Softban,
    ActionType.Kick,
    ActionType.Timeout,
    ActionType.TimeoutRemove,
    ActionType.TimeoutAdjust,
  ].includes(action);
}

export function actionTypeIsDurationBased(action: ActionType): boolean {
  return [ActionType.TempBan, ActionType.Timeout].includes(action);
}

export function actionTypeSupportsDM(action: ActionType): boolean {
  return ![
    ActionType.BanRemove,
    ActionType.History,
    ActionType.Lookup,
    ActionType.Note,
  ].includes(action);
}

/** The Discord permission a moderator exercises by running this action, if any. */
export function actionTypePermission(
  action: ActionType,
): PermissionName | null {
  switch (action) {
    case ActionType.Ban:
    case ActionType.TempBan:
    case ActionType.BanRemove:
    case ActionType.Softban:
      return "BanMembers";
    case ActionType.Kick:
      return "KickMembers";
    case ActionType.Timeout:
    case ActionType.TimeoutRemove:
    case ActionType.TimeoutAdjust:
      return "ModerateMembers";
    case ActionType.Warn:
    case ActionType.Note:
    case ActionType.History:
    case ActionType.Lookup:
      return null;
  }
}

// Serialization utility for persistence
export function actionTypeFromString(s: string): ActionType {
  switch (s) {
    case "ban":
      return ActionType.Ban;
    case "temp_ban":
      return ActionType.TempBan;
    case "unban":
      return ActionType.BanRemove;
    case "softban":
      return ActionType.Softban;
    case "kick":
      return ActionType.Kick;
    case "warn":
      return ActionType.Warn;
    case "timeout":
    case "mute": // Legacy support
      return ActionType.Timeout;
    case "timeout_remove":
    case "unmute": // Legacy support
      return ActionType.TimeoutRemove;
    case "timeout_adjust":
      return ActionType.TimeoutAdjust;
    case "history":
      return ActionType.History;
    case "lookup":
      return ActionType.Lookup;
    case "note":
      return ActionType.Note;
    default:
      throw new Error(`Invalid action ${s}`);
  }
}

export const ActionTypeBotEmojis = [
  "ban",
  "tempban",
  "unban",
  "message_delete",
  "kick",
  "timeout",
  "untimeout",
  "warn",
  "note",
  "history",
  "lookup",
] as const satisfies readonly BotEmojiNameType[];
