import type {
  ApplicationCommandOptionChoiceData,
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import type { Logger } from "pino";

import type { CaseRangeAutocompleteService } from "@/features/moderation/cases/application/CaseRangeAutocompleteService";
import { AutocompleteHandler } from "@/shared/presentation/handlers";

export type ReasonChoicesProvider = (
  guildId: string,
  input: string,
) => Promise<ApplicationCommandOptionChoiceData<string>[]>;

/** /reason and /uncase: `case` gets case ranges, /reason's `reason` gets templates. */
export class ReasonAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = ["reason", "uncase"];

  constructor(
    private readonly caseRangeAutocompleteService: CaseRangeAutocompleteService,
    private readonly reasonChoices: ReasonChoicesProvider,
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

    switch (option.name) {
      case "case":
        await this.respondWithCases(interaction, option.value);
        return;
      case "reason":
        await interaction.respond(
          await this.reasonChoices(interaction.guildId, option.value),
        );
        return;
      default:
        await interaction.respond([]);
    }
  }

  private async respondWithCases(
    interaction: AutocompleteInteraction<"cached">,
    query: string,
  ): Promise<void> {
    this.logger.debug(
      {
        guildId: interaction.guildId,
        query: query || "(empty)",
      },
      "Processing case autocomplete",
    );

    try {
      const choices =
        await this.caseRangeAutocompleteService.getAutocompleteSuggestions({
          guildId: interaction.guildId,
          query: query || "",
        });

      await interaction.respond(choices);
    } catch (err) {
      this.logger.error(
        {
          err,
          guildId: interaction.guildId,
          query,
        },
        "Failed to process autocomplete",
      );

      // Return empty array on error to prevent Discord API issues
      await interaction.respond([]);
    }
  }
}
