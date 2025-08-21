import type {
  APIApplicationCommandOptionChoice,
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";
import type { Logger } from "pino";

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

  constructor(
    private readonly giveawayService: GiveawayService,
    private readonly logger: Logger,
  ) {
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

    let giveawaysResult;
    let isCompleted = false;

    if (subcommand === GiveawaySubcommand.Reroll) {
      // Only show ENDED giveaways
      giveawaysResult = await this.giveawayService.getCompletedGiveaways(
        interaction.guildId,
      );
      isCompleted = true;
    } else {
      // Only show ACTIVE giveaways
      giveawaysResult = await this.giveawayService.getActiveGiveaways(
        interaction.guildId,
      );
    }

    if (!giveawaysResult.ok) {
      this.logger.error(
        { err: giveawaysResult.val, guildId: interaction.guildId },
        "Failed to get giveaways for autocomplete",
      );
      await interaction.respond([]);
      return;
    }

    const giveaways = giveawaysResult.val;

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
