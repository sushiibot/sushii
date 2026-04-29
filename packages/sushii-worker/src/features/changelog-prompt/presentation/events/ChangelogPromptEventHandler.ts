import type { Interaction } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { ChangelogPromptService } from "../../application/ChangelogPromptService";

export class ChangelogPromptEventHandler extends EventHandler<Events.InteractionCreate> {
  constructor(private readonly changelogPromptService: ChangelogPromptService) {
    super();
  }

  readonly eventType = Events.InteractionCreate;

  async handle(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    if (!interaction.inCachedGuild()) {
      return;
    }
    await this.changelogPromptService.maybePrompt(interaction);
  }
}
