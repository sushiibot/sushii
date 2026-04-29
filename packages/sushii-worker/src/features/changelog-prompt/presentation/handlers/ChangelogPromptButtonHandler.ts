import type { ButtonInteraction } from "discord.js";
import type { Logger } from "pino";

import { ButtonHandler } from "@/shared/presentation/handlers";

import type { ChangelogPromptService } from "../../application/ChangelogPromptService";
import { CUSTOM_IDS } from "../ChangelogPromptConstants";
import {
  buildDismissedMessage,
  buildSnoozedMessage,
} from "../views/ChangelogPromptMessageBuilder";

export class ChangelogPromptButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) => {
    if (customId === CUSTOM_IDS.SNOOZE || customId === CUSTOM_IDS.DISMISS) {
      return { path: customId, index: 0, params: {} };
    }
    return false;
  };

  constructor(
    private readonly changelogPromptService: ChangelogPromptService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const guildId = BigInt(interaction.guildId);

    if (interaction.customId === CUSTOM_IDS.SNOOZE) {
      await this.changelogPromptService.recordSnoozed(guildId);
      await interaction.update(buildSnoozedMessage());
    } else if (interaction.customId === CUSTOM_IDS.DISMISS) {
      await this.changelogPromptService.recordDismissed(guildId);
      await interaction.update(buildDismissedMessage());
    }
  }
}
