import type { ChatInputCommandInteraction } from "discord.js";
import type { Logger } from "pino";

import {
  RESPONSE_WINDOW_MS,
  expireActionResponse,
} from "../views/ModerationActionView";

/** The interaction token dies at 15 minutes, so the edit has to land before. */
const EXPIRY_MARGIN_MS = 30 * 1000;

export type ResponseExpiryScheduler = (
  interaction: Pick<
    ChatInputCommandInteraction,
    "createdTimestamp" | "fetchReply" | "editReply" | "id"
  >,
  logger: Logger,
) => void;

export function expiryDelayMs(createdTimestamp: number, now: number): number {
  return Math.max(
    0,
    createdTimestamp + RESPONSE_WINDOW_MS - EXPIRY_MARGIN_MS - now,
  );
}

export async function expireResponse(
  interaction: Pick<ChatInputCommandInteraction, "fetchReply" | "editReply">,
): Promise<boolean> {
  const reply = await interaction.fetchReply();
  const expired = expireActionResponse(reply.components.map((c) => c.toJSON()));
  if (!expired) {
    return false;
  }

  await interaction.editReply(expired);
  return true;
}

/**
 * Best effort: after a restart the timer is gone, and the next click strips
 * the buttons instead.
 */
export const scheduleResponseExpiry: ResponseExpiryScheduler = (
  interaction,
  logger,
) => {
  const timer = setTimeout(
    () => {
      expireResponse(interaction).catch((err: unknown) => {
        logger.debug(
          { err, interactionId: interaction.id },
          "Failed to expire mod action response buttons",
        );
      });
    },
    expiryDelayMs(interaction.createdTimestamp, Date.now()),
  );
  timer.unref?.();
};
