import type {
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import type { Logger } from "pino";

import { AutocompleteHandler } from "@/shared/presentation/handlers";

import type { TagSearchService } from "../../application/TagSearchService";

export class TagGetAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = ["t"];

  constructor(
    private readonly tagSearchService: TagSearchService,
    private readonly logger: Logger,
  ) {
    super();
  }

  protected async handleAutocomplete(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      return;
    }

    if (!this.validateStringOption(option)) {
      return;
    }

    const tags = await this.tagSearchService.searchTags({
      guildId: interaction.guildId,
      startsWith: option.value,
    });

    // searchTag already limits to 25, but just to be safe
    const choices = tags.slice(0, 25).map((tag) => ({
      name: tag.getName().getValue(),
      value: tag.getName().getValue(),
    }));

    await interaction.respond(choices);
  }
}
