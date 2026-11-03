import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";

export const REASON_EMOJIS = [
  "additional_message",
  "reason",
] as const satisfies readonly BotEmojiNameType[];

export type ReasonEmojis = EmojiMap<typeof REASON_EMOJIS>;

export type ReasonDeliveryState =
  | { sent: true; to: string }
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
    return `**${withEmoji(emojis.additional_message, "Reason")}** · sent to ${state.to} by DM`;
  }

  const why = state.why ? ` (${state.why})` : "";
  return `**${withEmoji(emojis.reason, "Reason")}** · not sent${why}`;
}
