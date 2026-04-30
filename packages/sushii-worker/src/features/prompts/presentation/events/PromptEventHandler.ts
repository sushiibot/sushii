import type { Interaction } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { PromptService } from "../../application/PromptService";

export class PromptEventHandler extends EventHandler<Events.InteractionCreate> {
  constructor(private readonly promptService: PromptService) {
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
    await this.promptService.maybePrompt(interaction);
  }
}
