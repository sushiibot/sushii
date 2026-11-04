import type { ChatInputCommandInteraction } from "discord.js";
import type { Logger } from "pino";

import {
  RESPONSE_WINDOW_MS,
  expireActionResponse,
  staleActionResponse,
} from "../views/ModerationActionView";
import {
  type ActionResponseRegistry,
  type LiveActionResponse,
  actionResponseRegistry,
} from "./responseRegistry";

/** The interaction token dies at 15 minutes, so the edit has to land before. */
const EXPIRY_MARGIN_MS = 30 * 1000;

type ResponseInteraction = Pick<
  ChatInputCommandInteraction,
  "createdTimestamp" | "fetchReply" | "editReply" | "id"
>;

export type ResponseExpiryScheduler = (
  interaction: ResponseInteraction,
  logger: Logger,
  registration?: { guildId: string; caseIds: string[] },
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

/** Edits the reply to the stale state while its token still works. */
export async function staleResponse(
  interaction: ResponseInteraction,
  now: number,
): Promise<boolean> {
  if (expiryDelayMs(interaction.createdTimestamp, now) === 0) {
    return false;
  }

  const reply = await interaction.fetchReply();
  const stale = staleActionResponse(
    reply.components.map((c) => c.toJSON()),
    null,
  );
  if (!stale) {
    return false;
  }

  await interaction.editReply(stale);
  return true;
}

/**
 * Best effort: after a restart the timer is gone, and the next click
 * disables the buttons instead.
 */
export function createResponseExpiryScheduler(
  registry: ActionResponseRegistry,
  now: () => number = Date.now,
): ResponseExpiryScheduler {
  return (interaction, logger, registration) => {
    let entry: LiveActionResponse | null = null;

    const timer = setTimeout(
      () => {
        if (entry) {
          registry.unregister(entry);
        }
        expireResponse(interaction).catch((err: unknown) => {
          logger.debug(
            { err, interactionId: interaction.id },
            "Failed to expire mod action response buttons",
          );
        });
      },
      expiryDelayMs(interaction.createdTimestamp, now()),
    );
    timer.unref?.();

    if (!registration) {
      return;
    }

    interaction
      .fetchReply()
      .then((reply) => {
        const live: LiveActionResponse = {
          guildId: registration.guildId,
          caseIds: [...registration.caseIds],
          messageId: reply.id,
          markStale: async () => {
            try {
              await staleResponse(interaction, now());
            } catch (err) {
              logger.debug(
                { err, interactionId: interaction.id },
                "Failed to mark mod action response stale",
              );
            }
          },
        };
        entry = live;
        registry.register(live);
      })
      .catch((err: unknown) => {
        logger.debug(
          { err, interactionId: interaction.id },
          "Failed to register mod action response for staleness",
        );
      });
  };
}

export const scheduleResponseExpiry: ResponseExpiryScheduler =
  createResponseExpiryScheduler(actionResponseRegistry);
