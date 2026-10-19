import { ApplicationCommandOptionType, PermissionFlagsBits } from "discord.js";
import type {
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import type { Logger } from "pino";

import { AutocompleteHandler } from "@/shared/presentation/handlers";

import type { TagSearchService } from "../../application/TagSearchService";

/**
 * tag-edit only allows editing tags the user owns, unless they have Manage
 * Guild (mirrors TagEditCommand and Tag.canBeModifiedBy). Returns the owner ID
 * to filter by, or undefined to show all tags.
 */
export function getAutocompleteOwnerFilter(
  interaction: AutocompleteInteraction<"cached">,
): string | undefined {
  if (interaction.commandName !== "tag-edit") {
    return undefined;
  }

  if (interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return undefined;
  }

  return interaction.user.id;
}

export class TagAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = ["tag.info", "tag-edit", "tag-admin.delete"];

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
      const tags = await this.tagSearchService.getTagsForAutocomplete(
        interaction.guildId,
        option.value,
        getAutocompleteOwnerFilter(interaction),
      );

      const choices = tags
        .filter((t) => {
          const name = t.getName().getValue().trim();
          return name.length >= 1 && name.length <= 100;
        })
        .slice(0, 25)
        .map((tag) => {
          const name = tag.getName().getValue().trim();
          return { name, value: name };
        });

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
