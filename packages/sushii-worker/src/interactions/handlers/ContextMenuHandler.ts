import type {
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import type { ContextMenuCommandInteraction } from "discord.js";
import InteractionHandler from "./InteractionHandler";

export default abstract class ContextMenuHandler extends InteractionHandler {
  /**
   * Data for command, e.g. the name, description, options
   */
  abstract readonly command:
    | RESTPostAPIChatInputApplicationCommandsJSONBody
    | RESTPostAPIApplicationCommandsJSONBody;

  /**
   * Field for the actual handler function
   */
  abstract handler(interaction: ContextMenuCommandInteraction): Promise<void>;
}
