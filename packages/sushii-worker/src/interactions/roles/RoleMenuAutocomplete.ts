import { ApplicationCommandOptionType } from "discord.js";
import { AutocompleteFocusedOption, AutocompleteInteraction } from "discord.js";
import { AutocompleteHandler } from "../handlers";
import { searchRoleMenus } from "../../db/RoleMenu/ModLog.repository";
import db from "../../infrastructure/database/db";

export default class RoleMenuAutocomplete extends AutocompleteHandler {
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

  async handler(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild missing");
    }

    if (option.type !== ApplicationCommandOptionType.String) {
      throw new Error("Option type must be string.");
    }

    const matching = await searchRoleMenus(
      db,
      interaction.guildId,
      option.value,
    );

    const choices = matching.slice(0, 25).map((s) => ({
      name: s.menu_name,
      value: s.menu_name,
    }));

    await interaction.respond(choices || []);
  }
}
