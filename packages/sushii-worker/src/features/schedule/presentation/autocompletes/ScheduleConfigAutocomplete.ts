import type {
  APIApplicationCommandOptionChoice,
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import type { Logger } from "pino";

import { AutocompleteHandler } from "@/shared/presentation/handlers";

import type { ScheduleChannelService } from "../../application/ScheduleChannelService";
import {
  SCHEDULE_CONFIG_SUBCOMMANDS,
} from "../ScheduleConfigConstants";

export class ScheduleConfigAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = [
    `schedule-config.${SCHEDULE_CONFIG_SUBCOMMANDS.EDIT}`,
    `schedule-config.${SCHEDULE_CONFIG_SUBCOMMANDS.REMOVE}`,
    `schedule-config.${SCHEDULE_CONFIG_SUBCOMMANDS.REFRESH}`,
  ];

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

    if (schedules.length === 0) {
      await interaction.respond([]);
      return;
    }

    const guild = interaction.inCachedGuild() ? interaction.guild : null;

    const choices: APIApplicationCommandOptionChoice<string>[] = schedules.map((schedule) => {
      const channel = guild?.channels.cache.get(schedule.channelId.toString());
      const channelName = channel ? `#${channel.name}` : `<#${schedule.channelId}>`;
      const calendarName = schedule.displayTitle;

      const prefix = `${channelName} — `;
      const maxCalendarLen = 100 - prefix.length;
      const truncatedCalendar =
        calendarName.length > maxCalendarLen
          ? calendarName.slice(0, maxCalendarLen - 1) + "…"
          : calendarName;
      const name = `${prefix}${truncatedCalendar}`;

      return {
        name,
        value: schedule.channelId.toString(),
      };
    });

    await interaction.respond(choices);
  }
}
