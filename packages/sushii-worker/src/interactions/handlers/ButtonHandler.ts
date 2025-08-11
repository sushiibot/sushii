import type { ButtonInteraction } from "discord.js";

import MessageComponentHandler from "./MessageComponentHandler";

export default abstract class ButtonHandler extends MessageComponentHandler {
  /**
   * Button submit handler function
   */
  abstract handleInteraction(interaction: ButtonInteraction): Promise<void>;
}
