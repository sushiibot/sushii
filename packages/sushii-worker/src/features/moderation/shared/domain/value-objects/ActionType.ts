import type { BotEmojiNameType } from "@/features/bot-emojis";

export enum ActionType {
  Ban = "ban",
  TempBan = "temp_ban",
  BanRemove = "unban",
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

// Serialization utility for persistence
export function actionTypeFromString(s: string): ActionType {
  switch (s) {
    case "ban":
      return ActionType.Ban;
    case "temp_ban":
      return ActionType.TempBan;
    case "unban":
      return ActionType.BanRemove;
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
  "kick",
  "timeout",
  "untimeout",
  "warn",
  "note",
  "history",
  "lookup",
] as const satisfies readonly BotEmojiNameType[];
