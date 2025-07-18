import {
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import { ChatInputCommandInteraction } from "discord.js";
import InteractionHandler from "./InteractionHandler";

export default abstract class SlashCommandHandler extends InteractionHandler {
  /**
   * Data for command, e.g. the name, description, options
   */
  abstract readonly command:
    | RESTPostAPIChatInputApplicationCommandsJSONBody
    | RESTPostAPIApplicationCommandsJSONBody;

  /**
   * Field for the actual handler function
   */
  abstract handler(interaction: ChatInputCommandInteraction): Promise<void>;
}
