import type { Interaction } from "discord.js";
import { Events } from "discord.js";

import type InteractionRouter from "@/core/cluster/discord/InteractionRouter";
import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import { StatName, type StatsService } from "@/features/stats";

/**
 * Event handler for Discord InteractionCreate events.
 * Handles all Discord interactions (commands, buttons, etc.) with tracing and stats tracking.
 */
export class InteractionCreateHandler extends EventHandler<Events.InteractionCreate> {
  constructor(
    private readonly interactionRouter: InteractionRouter,
    private readonly statsService: StatsService,
  ) {
    super();
  }

  readonly eventType = Events.InteractionCreate;

  async handle(interaction: Interaction): Promise<void> {
    await this.interactionRouter.handleAPIInteraction(interaction);
    await this.statsService.updateStat(StatName.CommandCount, 1, "add");
  }
}
