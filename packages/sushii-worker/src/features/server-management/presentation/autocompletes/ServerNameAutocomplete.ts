import type {
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";

import { AutocompleteHandler } from "@/shared/presentation/handlers";

import type { ServerAppearanceService } from "../../application/ServerAppearanceService";

export class ServerNameAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = "server.name";

  constructor(private readonly appearanceService: ServerAppearanceService) {
    super();
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      await interaction.respond([]);
      return;
    }

    const names = await this.appearanceService.suggestNames(
      interaction.guild,
      option.value,
    );

    await interaction.respond(names.map((name) => ({ name, value: name })));
  }
}
