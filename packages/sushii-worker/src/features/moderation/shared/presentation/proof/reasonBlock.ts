import { escapeMarkdown } from "discord.js";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import {
  guildDmText,
  guildDmTextSetting,
} from "../../application/DMNotificationService";
import type {
  DMFailureReason,
  ModerationCase,
} from "../../domain/entities/ModerationCase";
import {
  type ActionType,
  actionTypeSupportsDM,
} from "../../domain/value-objects/ActionType";

export const REASON_EMOJIS = [
  "dm_sent",
  "reason",
] as const satisfies readonly BotEmojiNameType[];

export type ReasonEmojis = EmojiMap<typeof REASON_EMOJIS>;

export type ReasonDeliveryState =
  | { sent: true; to: string }
  /** `why` is bot-written text and may hold markdown, so it isn't escaped. */
  | { sent: false; why?: string };

/** A missing bot emoji arrives as "", which must not leave a stray space inside the bold. */
export function withEmoji(emoji: string, label: string): string {
  return emoji ? `${emoji} ${label}` : label;
}

export function reasonHeading(
  emojis: ReasonEmojis,
  state: ReasonDeliveryState,
): string {
  if (state.sent) {
    return `**${withEmoji(emojis.dm_sent, "Reason")}** · sent to ${escapeMarkdown(state.to)} by DM`;
  }

  const why = state.why ? ` (${state.why})` : "";
  return `**${withEmoji(emojis.reason, "Reason")}** · not sent${why}`;
}

const DM_FAILURE_TEXT: Record<DMFailureReason, string> = {
  user_blocked: "they have DMs off or blocked sushii",
  user_privacy: "they have server DMs off or share no server with sushii",
  user_cannot_receive: "Discord won't deliver DMs to them",
  unknown: "Discord returned an error",
};

export function dmFailureText(reason: DMFailureReason): string {
  return DM_FAILURE_TEXT[reason];
}

export function hasLiveDm(moderationCase: ModerationCase): boolean {
  return (
    !moderationCase.dmDeleted &&
    !!moderationCase.dmResult?.channelId &&
    !!moderationCase.dmResult.messageId
  );
}

export type NotSentCause = "not_in_guild" | "executor_no" | "guild_default";

export type CaseDmState =
  | { kind: "live" }
  | { kind: "deleted" }
  | { kind: "failed"; reason: DMFailureReason }
  /** cause is null for actions without a DM and for older cases that didn't record one. */
  | { kind: "not_sent"; cause: NotSentCause | null };

export function caseDmState(moderationCase: ModerationCase): CaseDmState {
  if (moderationCase.dmDeleted) {
    return { kind: "deleted" };
  }
  if (hasLiveDm(moderationCase)) {
    return { kind: "live" };
  }
  if (moderationCase.dmFailed || moderationCase.dmFailureReason) {
    return {
      kind: "failed",
      reason:
        moderationCase.dmFailureReason ??
        moderationCase.dmResult?.failureReason ??
        "unknown",
    };
  }
  if (!actionTypeSupportsDM(moderationCase.actionType)) {
    return { kind: "not_sent", cause: null };
  }
  if (moderationCase.dmNotAttemptedReason === "user_not_in_guild") {
    return { kind: "not_sent", cause: "not_in_guild" };
  }
  switch (moderationCase.dmIntentSource) {
    case "executor_no":
      return { kind: "not_sent", cause: "executor_no" };
    case "guild_default":
      return { kind: "not_sent", cause: "guild_default" };
    default:
      return { kind: "not_sent", cause: null };
  }
}

/** "ban" for a ban DM, or null for actions without a DM text setting. */
export function dmKind(actionType: ActionType): string | null {
  switch (guildDmTextSetting(actionType)) {
    case "banDmText":
      return "ban";
    case "kickDmText":
      return "kick";
    case "warnDmText":
      return "warn";
    case "timeoutDmText":
      return "timeout";
    default:
      return null;
  }
}

/** Why no DM was sent, e.g. "ban DMs are off". */
export function notSentWhy(
  cause: NotSentCause | null,
  actionType: ActionType,
): string | null {
  switch (cause) {
    case "not_in_guild":
      return "they weren't in the server";
    case "executor_no":
      return "the mod chose no DM";
    case "guild_default": {
      const kind = dmKind(actionType);
      return kind ? `${kind} DMs are off` : "DMs are off";
    }
    default:
      return null;
  }
}

export type ReasonDelivery =
  | { sent: true }
  | { sent: false; why: string | null };

/** Whether the user still has the reason in their DMs, and if not, why. */
export function reasonDelivery(moderationCase: ModerationCase): ReasonDelivery {
  const state = caseDmState(moderationCase);
  switch (state.kind) {
    case "live":
      return { sent: true };
    case "deleted":
      return {
        sent: false,
        why: moderationCase.dmDeletedBy
          ? `DM deleted by <@${moderationCase.dmDeletedBy}>`
          : "DM deleted",
      };
    case "failed":
      return { sent: false, why: `DM failed: ${dmFailureText(state.reason)}` };
    case "not_sent":
      return {
        sent: false,
        why: notSentWhy(state.cause, moderationCase.actionType),
      };
  }
}

export function alsoIncludedLine(actionType: ActionType): string {
  return `Also included your server's ${dmKind(actionType) ?? "DM"} message`;
}

/**
 * Whether the delivered DM carried the server's DM text from `/settings`.
 * Read from the current settings, which may have changed since the DM.
 */
export function serverDmTextIncluded(
  moderationCase: ModerationCase,
  guildConfig: GuildConfig,
): boolean {
  return (
    hasLiveDm(moderationCase) &&
    !!guildDmText(moderationCase.actionType, guildConfig)?.trim()
  );
}
