import type { ChatInputCommandInteraction } from "discord.js";
import type { Logger } from "pino";

import {
  RESPONSE_WINDOW_MS,
  expireActionResponse,
  staleActionResponse,
} from "../views/ModerationActionView";
import type { ModLogUrlResolver } from "./modLogEntryUrl";
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
  registration?: {
    guildId: string;
    caseIds: string[];
    /** The posted response; without it the reply is fetched. */
    messageId?: string;
  },
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
  modLogUrl: string | null,
): Promise<boolean> {
  if (expiryDelayMs(interaction.createdTimestamp, now) === 0) {
    return false;
  }

  const reply = await interaction.fetchReply();
  const stale = staleActionResponse(
    reply.components.map((c) => c.toJSON()),
    modLogUrl,
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
  options: {
    now?: () => number;
    /** Links the mod log entry from the stale line. */
    resolveModLogUrl?: ModLogUrlResolver;
  } = {},
): ResponseExpiryScheduler {
  const now = options.now ?? Date.now;
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

    const register = (messageId: string): void => {
      const live: LiveActionResponse = {
        guildId: registration.guildId,
        caseIds: [...registration.caseIds],
        messageId,
        // Resolved only when marked, since the mod log entry is posted after the response.
        markStale: async () => {
          try {
            const url = options.resolveModLogUrl
              ? await options
                  .resolveModLogUrl(registration.guildId, registration.caseIds)
                  .catch((err: unknown) => {
                    logger.debug(
                      { err, interactionId: interaction.id },
                      "Failed to find the mod log entry for a stale response",
                    );
                    return null;
                  })
              : null;
            await staleResponse(interaction, now(), url);
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
    };

    if (registration.messageId) {
      register(registration.messageId);
      return;
    }

    interaction
      .fetchReply()
      .then((reply) => register(reply.id))
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
