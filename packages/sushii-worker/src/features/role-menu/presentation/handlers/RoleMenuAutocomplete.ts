import { ApplicationCommandOptionType } from "discord.js";
import type {
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import type { Logger } from "pino";

import { AutocompleteHandler } from "@/interactions/handlers";

import type { RoleMenuManagementService } from "../../application/RoleMenuManagementService";

export class RoleMenuAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = [
    "rolemenu.get",
    "rolemenu.edit",
    "rolemenu.editorder",
    "rolemenu.addroles",
    "rolemenu.removeroles",
    "rolemenu.delete",
    "rolemenu.send",
    "rolemenu.roleoptions",
  ];

  constructor(
    private readonly roleMenuManagementService: RoleMenuManagementService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild missing");
    }

    if (option.type !== ApplicationCommandOptionType.String) {
      throw new Error("Option type must be string.");
    }

    try {
      const matching = await this.roleMenuManagementService.searchMenus(
        interaction.guildId,
        option.value,
      );

      const choices = matching.slice(0, 25).map((menu) => ({
        name: menu.menuName,
        value: menu.menuName,
      }));

      await interaction.respond(choices || []);
    } catch (error) {
      this.logger.error({ err: error, guildId: interaction.guildId, query: option.value }, "Failed to handle autocomplete");
      await interaction.respond([]);
    }
  }
}