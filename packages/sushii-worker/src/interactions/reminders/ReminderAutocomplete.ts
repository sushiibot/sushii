import dayjs from "@/shared/domain/dayjs";
import type {
  AutocompleteFocusedOption,
  AutocompleteInteraction,
  APIApplicationCommandOptionChoice} from "discord.js";
import {
  ApplicationCommandOptionType,
} from "discord.js";
import { getDurationFromNow } from "../../utils/getDuration";
import { AutocompleteHandler } from "../handlers";
import { listReminders } from "../../db/Reminder/Reminder.repository";
import db from "../../infrastructure/database/db";

export default class ReminderDeleteAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = "reminder.delete";

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (option.type !== ApplicationCommandOptionType.String) {
      throw new Error("Option type must be string.");
    }

    const matching = await listReminders(db, interaction.user.id);

    const choices: APIApplicationCommandOptionChoice[] | undefined = matching
      .filter((r) => r.description.startsWith(option.value) && r)
      .filter((r) => !!r)
      .slice(0, 25)
      .map((s) => {
        const durStr = getDurationFromNow(dayjs.utc(s.expire_at)).humanize();

        return {
          name: `ID: ${s.id} - Expiring in: ${durStr} - Description: ${s.description}`,
          value: s.id,
        };
      });

    await interaction.respond(choices || []);
  }
}
