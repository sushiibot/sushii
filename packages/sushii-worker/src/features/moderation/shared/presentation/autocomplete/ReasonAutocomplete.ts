import type {
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import type { Logger } from "pino";

import type { CaseRangeAutocompleteService } from "@/features/moderation/cases/application/CaseRangeAutocompleteService";
import { AutocompleteHandler } from "@/shared/presentation/handlers";

export class ReasonAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = ["reason", "uncase"];

  constructor(
    private readonly caseRangeAutocompleteService: CaseRangeAutocompleteService,
    private readonly logger: Logger,
  ) {
    super();
  }

  protected async handleAutocomplete(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Must be in guild.");
    }

    if (!this.validateStringOption(option)) {
      throw new Error("Option type must be a string.");
    }

    this.logger.debug(
      {
        guildId: interaction.guildId,
        query: option.value || "(empty)",
        optionName: option.name,
      },
      "Processing case autocomplete",
    );

    try {
      const choices =
        await this.caseRangeAutocompleteService.getAutocompleteSuggestions({
          guildId: interaction.guildId,
          query: option.value || "",
        });

      await interaction.respond(choices);
    } catch (error) {
      this.logger.error(
        {
          error,
          guildId: interaction.guildId,
          query: option.value,
        },
        "Failed to process autocomplete",
      );

      // Return empty array on error to prevent Discord API issues
      await interaction.respond([]);
    }
  }
}
