import type {
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import { ApplicationCommandOptionType, SlashCommandBuilder } from "discord.js";

import {
  COMMAND_CONFIGS,
  OPTION_NAMES,
} from "@/features/moderation/shared/presentation/commands/ModerationCommandConstants";
import { AutocompleteHandler } from "@/shared/presentation/handlers";

import type { ReasonTemplateService } from "../../application/ReasonTemplateService";
import { RECENT_REASON_LIMIT } from "../../application/ReasonTemplateService";
import type { ReasonChoice } from "./reasonChoices";
import { buildReasonChoices } from "./reasonChoices";

/** Mod action commands whose reason option has autocomplete turned on. */
export function reasonAutocompleteCommandNames(): string[] {
  return Object.values(COMMAND_CONFIGS)
    .filter((config) =>
      config
        .options(
          new SlashCommandBuilder()
            .setName(config.name)
            .setDescription(config.description),
        )
        .toJSON()
        .options?.some(
          (option) =>
            option.name === OPTION_NAMES.REASON &&
            option.type === ApplicationCommandOptionType.String &&
            option.autocomplete === true,
        ),
    )
    .map((config) => config.name);
}

export async function loadReasonChoices(
  service: Pick<ReasonTemplateService, "listAll" | "recentReasons">,
  guildId: string,
  input: string,
): Promise<ReasonChoice[]> {
  const [templates, recents] = await Promise.all([
    service.listAll(guildId),
    service.recentReasons(guildId, RECENT_REASON_LIMIT),
  ]);

  return buildReasonChoices(input, { templates, recents });
}

export class ReasonTemplateAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = reasonAutocompleteCommandNames();

  constructor(
    private readonly reasonTemplateService: Pick<
      ReasonTemplateService,
      "listAll" | "recentReasons"
    >,
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

    if (option.name !== "reason" || !this.validateStringOption(option)) {
      await interaction.respond([]);
      return;
    }

    await interaction.respond(
      await loadReasonChoices(
        this.reasonTemplateService,
        interaction.guildId,
        option.value,
      ),
    );
  }
}
