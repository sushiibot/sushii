import type {
  APIApplicationCommandOptionChoice,
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import type { Logger } from "pino";

import { AutocompleteHandler } from "@/shared/presentation/handlers";

import type { ScheduleChannelService } from "../../application/ScheduleChannelService";

export const SCHEDULE_ALL_VALUE = "all";

export class ScheduleAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = ["schedule"];

  constructor(
    private readonly scheduleChannelService: ScheduleChannelService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
    _option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    const schedules = await this.scheduleChannelService.listForGuild(BigInt(interaction.guildId));

    const choices: APIApplicationCommandOptionChoice<string>[] = [
      { name: "All schedules", value: SCHEDULE_ALL_VALUE },
      ...schedules.map((schedule) => ({
        name: schedule.displayTitle.length > 100
          ? schedule.displayTitle.slice(0, 99) + "…"
          : schedule.displayTitle,
        value: schedule.calendarId,
      })),
    ];

    await interaction.respond(choices);
  }
}
