import type {
  APIApplicationCommandOptionChoice,
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";

import { AutocompleteHandler } from "@/interactions/handlers";
import dayjs from "@/shared/domain/dayjs";
import { getDurationFromNow } from "@/utils/getDuration";

import type { ReminderService } from "../application/ReminderService";

export class ReminderDeleteAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = "reminder.delete";

  constructor(private readonly reminderService: ReminderService) {
    super();
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (option.type !== ApplicationCommandOptionType.String) {
      throw new Error("Option type must be string.");
    }

    const matching = await this.reminderService.getRemindersForAutocomplete(
      interaction.user.id,
      option.value,
    );

    const choices: APIApplicationCommandOptionChoice[] = matching
      .slice(0, 25)
      .map((reminder) => {
        const durStr = getDurationFromNow(
          dayjs.utc(reminder.getExpireAt()),
        ).humanize();

        let str = `ID: ${reminder.getId()} - Expiring in: ${durStr} - Description: ${reminder.getDescription()}`;

        if (str.length > 100) {
          str = str.substring(0, 97) + "...";
        }

        return {
          name: str,
          value: reminder.getId(),
        };
      });

    await interaction.respond(choices);
  }
}
