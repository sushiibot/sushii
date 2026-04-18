import type {
  RESTPostAPIApplicationCommandsJSONBody,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import InteractionHandler from "./InteractionHandler";

export default abstract class SlashCommandHandler extends InteractionHandler {
  /**
   * Data for command, e.g. the name, description, options
   */
  abstract readonly command:
    | RESTPostAPIChatInputApplicationCommandsJSONBody
    | RESTPostAPIApplicationCommandsJSONBody;

  /**
   * If set, this command is registered only to these guilds and invisible
   * everywhere else. If unset, the command is registered globally.
   */
  readonly registeredGuilds?: readonly string[];

  /**
   * Field for the actual handler function
   */
  abstract handler(interaction: ChatInputCommandInteraction): Promise<void>;
}
