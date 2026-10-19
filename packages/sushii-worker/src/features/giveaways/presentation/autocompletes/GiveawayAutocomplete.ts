import type {
  APIApplicationCommandOptionChoice,
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";

import dayjs from "@/shared/domain/dayjs";
import { AutocompleteHandler } from "@/shared/presentation/handlers";
import { getDurationFromNow } from "@/utils/getDuration";

import type { GiveawayService } from "../../application/GiveawayService";

enum GiveawaySubcommand {
  Delete = "delete",
  End = "end",
  Reroll = "reroll",
}

export class GiveawayAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = [
    `giveaway.${GiveawaySubcommand.Delete}`,
    `giveaway.${GiveawaySubcommand.End}`,
    `giveaway.${GiveawaySubcommand.Reroll}`,
  ];

  constructor(private readonly giveawayService: GiveawayService) {
    super();
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Interaction is not in a cached guild.");
    }

    if (option.type !== ApplicationCommandOptionType.String) {
      throw new Error("Option type must be string.");
    }

    const subcommand = interaction.options.getSubcommand();

    // Reroll only shows ended giveaways, the rest only show active ones
    const isCompleted = subcommand === GiveawaySubcommand.Reroll;
    const giveaways = isCompleted
      ? await this.giveawayService.getCompletedGiveaways(interaction.guildId)
      : await this.giveawayService.getActiveGiveaways(interaction.guildId);

    const choices: APIApplicationCommandOptionChoice[] = giveaways
      .slice(0, 25)
      .map((giveaway) => {
        const durStr = getDurationFromNow(dayjs.utc(giveaway.endAt)).humanize();

        let name = `ID: ${giveaway.id} - `;

        if (isCompleted) {
          name += `Ended: ${durStr} ago`;
        } else {
          name += `Ending in: ${durStr}`;
        }

        name += ` - Prize: ${giveaway.prize}`;

        // Truncate to max length
        if (name.length > 100) {
          name = name.slice(0, 97) + "...";
        }

        return {
          name,
          value: giveaway.id,
        };
      });

    await interaction.respond(choices);
  }
}
