import type { AnySelectMenuInteraction } from "discord.js";

import MessageComponentHandler from "./MessageComponentHandler";

export default abstract class SelectMenuHandler extends MessageComponentHandler {
  /**
   * Select menu submit handler function
   */
  abstract handleInteraction(
    interaction: AnySelectMenuInteraction,
  ): Promise<void>;
}
