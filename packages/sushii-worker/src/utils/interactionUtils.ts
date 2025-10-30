import type {
  ButtonInteraction,
  InteractionReplyOptions,
  InteractionResponse,
} from "discord.js";
import type { Logger } from "pino";

/**
 * Maximum time (in milliseconds) that a Discord interaction is valid for responses
 * Discord interactions expire after 15 minutes
 */
const INTERACTION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check if an interaction is still valid (not expired)
 */
export function isInteractionValid(interaction: ButtonInteraction): boolean {
  const now = Date.now();
  const interactionTime = interaction.createdTimestamp;
  return now - interactionTime < INTERACTION_TIMEOUT_MS;
}

/**
 * Safely reply to an interaction, checking if it's already been replied to or expired
 */
export async function safeReply(
  interaction: ButtonInteraction,
  options: InteractionReplyOptions,
  logger: Logger,
): Promise<InteractionResponse | null> {
  try {
    // Check if interaction has already been replied to or deferred
    if (interaction.replied || interaction.deferred) {
      logger.warn(
        {
          interactionId: interaction.id,
          replied: interaction.replied,
          deferred: interaction.deferred,
        },
        "Attempted to reply to already handled interaction",
      );
      return null;
    }

    // Check if interaction is still valid
    if (!isInteractionValid(interaction)) {
      logger.warn(
        {
          interactionId: interaction.id,
          createdAt: interaction.createdTimestamp,
          age: Date.now() - interaction.createdTimestamp,
        },
        "Attempted to reply to expired interaction",
      );
      return null;
    }

    return await interaction.reply(options);
  } catch (error) {
    logger.error(
      {
        err: error,
        interactionId: interaction.id,
        replied: interaction.replied,
        deferred: interaction.deferred,
      },
      "Failed to reply to interaction",
    );
    return null;
  }
}

/**
 * Safely delete an interaction reply with proper error handling
 */
export async function safeDeleteReply(
  interactionResponse: InteractionResponse | null,
  logger: Logger,
  context?: Record<string, unknown>,
): Promise<void> {
  if (!interactionResponse) {
    return;
  }

  try {
    // Get the message from the interaction response
    const message = await interactionResponse.fetch();
    await message.delete();
    logger.debug(
      { messageId: message.id, ...context },
      "Successfully deleted interaction reply",
    );
  } catch (error) {
    // Log as debug since this is often expected (e.g., user already dismissed the message)
    logger.debug(
      {
        err: error,
        ...context,
      },
      "Failed to delete interaction reply",
    );
  }
}
