import type { BaseInteraction, PermissionsBitField } from "discord.js";

/**
 * Response of a command check, a message will only exist on pass = false
 */
export type CheckResponse =
  | {
      pass: true;
    }
  | {
      pass: false;
      message: string;
    };

export default abstract class InteractionHandler {
  /**
   * Required permissions for the **bot** to run the command, ie. ban members
   */
  readonly requiredBotPermissions?: PermissionsBitField;

  /**
   * Interaction handler
   */
  abstract handler(
    interaction: BaseInteraction,
    data?: unknown, // Any additional data to pass
  ): Promise<void>;
}
