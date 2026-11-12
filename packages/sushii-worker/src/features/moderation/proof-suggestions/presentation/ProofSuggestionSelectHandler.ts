import type {
  APIMessageTopLevelComponent,
  AnySelectMenuInteraction,
} from "discord.js";
import { MessageFlags } from "discord.js";

import { SelectMenuHandler } from "@/shared/presentation/handlers";
import {
  ANY_MOD_PERMISSION,
  requireMemberPermission,
} from "@/shared/presentation/requireMemberPermission";

import { isSuggestSelectId, parseSuggestSelectId } from "./customIds";
import { OUT_OF_DATE_TEXT } from "./suggestionText";
import { buildSuggestionNotice, pickerWithSelection } from "./views";

/** Keeps the picker's Add button count in step with the select. */
export class ProofSuggestionSelectHandler extends SelectMenuHandler {
  customIDMatch = (customId: string) =>
    isSuggestSelectId(customId)
      ? { path: customId, index: 0, params: {} }
      : false;

  async handleInteraction(
    interaction: AnySelectMenuInteraction,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    if (
      !(await requireMemberPermission(
        interaction,
        ANY_MOD_PERMISSION.flags,
        ANY_MOD_PERMISSION.name,
      ))
    ) {
      return;
    }

    const posted = interaction.message.components.map((c) =>
      c.toJSON(),
    ) as APIMessageTopLevelComponent[];
    const updated = parseSuggestSelectId(interaction.customId)
      ? pickerWithSelection(posted, interaction.values)
      : null;
    if (!updated) {
      await interaction.reply({
        ...buildSuggestionNotice(OUT_OF_DATE_TEXT),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.update(
      updated as Parameters<typeof interaction.update>[0],
    );
  }
}
