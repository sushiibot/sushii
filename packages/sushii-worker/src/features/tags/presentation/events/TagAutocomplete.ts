import { ApplicationCommandOptionType } from "discord.js";
import type { AutocompleteFocusedOption, AutocompleteInteraction } from "discord.js";
import type { Logger } from "pino";

import { AutocompleteHandler } from "@/interactions/handlers";

import type { TagSearchService } from "../../application/TagSearchService";

export class TagAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = ["tag.info", "tag-edit", "tagadmin.delete"];

  constructor(
    private readonly tagSearchService: TagSearchService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not in cached guild");
    }

    if (option.type !== ApplicationCommandOptionType.String) {
      throw new Error("Option type must be string.");
    }

    try {
      // TODO: For tag-edit, it should only show tags owned by the user or all
      // only if they have the "Manage Guild" permission.
      const tags = await this.tagSearchService.getTagsForAutocomplete(
        interaction.guildId,
        option.value,
      );

      const choices = tags.slice(0, 25).map((tag) => ({
        name: tag.getName().getValue(),
        value: tag.getName().getValue(),
      }));

      await interaction.respond(choices || []);
    } catch (error) {
      this.logger.error(
        { error, guildId: interaction.guildId, query: option.value },
        "Error handling tag autocomplete",
      );
      await interaction.respond([]);
    }
  }
}
