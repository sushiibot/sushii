import type { ModalSubmitInteraction } from "discord.js";
import type { match } from "path-to-regexp";

export default abstract class ModalHandler {
  /**
   * Url-like path to match against
   */
  abstract readonly customIDMatch: ReturnType<typeof match>;

  /**
   * Modal submit handler function
   */
  abstract handleModalSubmit(
    interaction: ModalSubmitInteraction,
  ): Promise<void>;
}
