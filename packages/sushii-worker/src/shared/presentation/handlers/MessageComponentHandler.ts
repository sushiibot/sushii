import type { MessageComponentInteraction } from "discord.js";
import type { match } from "path-to-regexp";

export default abstract class MessageComponentHandler {
  /**
   * Url-like path to match against
   */
  abstract readonly customIDMatch: ReturnType<typeof match>;

  /**
   * Button/dropdown/etc submit handler function
   */
  abstract handleInteraction(
    interaction: MessageComponentInteraction,
  ): Promise<void>;
}
