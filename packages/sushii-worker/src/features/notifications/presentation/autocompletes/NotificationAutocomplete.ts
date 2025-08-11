import type {
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";

import { AutocompleteHandler } from "@/interactions/handlers";

import type { NotificationService } from "../../application/NotificationService";

export class NotificationAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = "notification.delete";

  constructor(private readonly notificationService: NotificationService) {
    super();
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (option.type !== ApplicationCommandOptionType.String) {
      throw new Error("Option type must be string.");
    }

    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const matching = await this.notificationService.searchNotifications(
      interaction.guildId,
      interaction.user.id,
      option.value,
    );

    const choices = matching
      .filter((notification) => notification.keyword.length <= 100)
      .slice(0, 25)
      .map((notification) => ({
        name: notification.keyword,
        value: notification.keyword,
      }));

    await interaction.respond(choices);
  }
}
