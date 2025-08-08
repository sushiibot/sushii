import type {
  AutocompleteFocusedOption,
  AutocompleteInteraction} from "discord.js";
import {
  ApplicationCommandOptionType,
} from "discord.js";
import InteractionHandler from "./InteractionHandler";

export default abstract class AutocompleteHandler extends InteractionHandler {
  /**
   * Path of command including parent commands joined with periods.
   * Example for /notification add:
   * fullCommandNamePath = "notification.add"
   *
   * Example for /notification:
   * fullCommandNamePath = "notification"
   *
   * Array support for shared handlers:
   * fullCommandNamePath = ["tag.get", "tag.edit"] - same handler for multiple commands
   */
  abstract readonly fullCommandNamePath: string | string[];

  /**
   * Get all paths this handler should be registered for
   */
  public getPaths(): string[] {
    return Array.isArray(this.fullCommandNamePath)
      ? this.fullCommandNamePath
      : [this.fullCommandNamePath];
  }

  /**
   * Validate that the focused option is a string type before processing
   */
  protected validateStringOption(
    option: AutocompleteFocusedOption,
  ): option is AutocompleteFocusedOption & {
    type: ApplicationCommandOptionType.String;
  } {
    return option.type === ApplicationCommandOptionType.String;
  }

  /**
   * Handle autocomplete interaction with error boundary
   */
  async handler(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    try {
      await this.handleAutocomplete(interaction, option);
    } catch (error) {
      // Provide empty response on error to prevent Discord timeout
      await interaction.respond([]).catch(() => {
        // Ignore response errors if interaction already timed out
      });

      // Re-throw for logging by router
      throw error;
    }
  }

  /**
   * Implement this method to handle the autocomplete logic
   */
  protected abstract handleAutocomplete(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void>;
}
