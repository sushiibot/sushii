import type { ButtonInteraction } from "discord.js";
import type { Logger } from "pino";

import { ButtonHandler } from "@/shared/presentation/handlers";

import type { PromptService } from "../../application/PromptService";
import { parseCustomId } from "../customIds";
import { buildDismissedMessage, buildSnoozedMessage } from "../views/buildPromptMessage";

export class PromptButtonHandler extends ButtonHandler {
  // Matches prompt:*:snooze and prompt:*:dismiss for all prompts
  customIDMatch = (customId: string) => {
    const parsed = parseCustomId(customId);
    if (!parsed) {
      return false;
    }
    if (parsed.action !== "snooze" && parsed.action !== "dismiss") {
      return false;
    }
    return { path: customId, index: 0, params: {} };
  };

  constructor(
    private readonly promptService: PromptService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const parsed = parseCustomId(interaction.customId);
    if (!parsed) {
      return;
    }

    const guildId = BigInt(interaction.guildId);

    if (parsed.action === "snooze") {
      await this.promptService.recordSnoozed(guildId, parsed.promptId);
      await interaction.update(buildSnoozedMessage());
    } else if (parsed.action === "dismiss") {
      await this.promptService.recordDismissed(guildId, parsed.promptId);
      await interaction.update(buildDismissedMessage());
    }
  }
}
