import type { ComponentEmojiResolvable } from "discord.js";
import { ButtonBuilder, ButtonStyle } from "discord.js";

import type { FeedbackFeatureKey } from "../../domain/Feedback";
import { buildErrorButtonId, buildPanelButtonId } from "../customIds";

const DEFAULT_EMOJI = "💬";

export function buildErrorFeedbackButton(
  invokerId: string,
  traceId?: string | null,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildErrorButtonId(invokerId, traceId))
    .setLabel("Send feedback")
    .setEmoji(DEFAULT_EMOJI)
    .setStyle(ButtonStyle.Secondary);
}

export function buildFeedbackPanelButton(
  feature: FeedbackFeatureKey,
  emoji: ComponentEmojiResolvable = DEFAULT_EMOJI,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildPanelButtonId(feature))
    .setLabel("Feedback")
    .setEmoji(emoji)
    .setStyle(ButtonStyle.Secondary);
}
