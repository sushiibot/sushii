import type { Span, Tracer } from "@opentelemetry/api";
import type { Interaction } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import type InteractionRouter from "@/core/cluster/discord/InteractionRouter";
import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import { StatName, updateStat } from "@/tasks/StatsTask";

/**
 * Event handler for Discord InteractionCreate events.
 * Handles all Discord interactions (commands, buttons, etc.) with tracing and stats tracking.
 */
export class InteractionCreateHandler extends EventHandler<Events.InteractionCreate> {
  constructor(
    private readonly interactionRouter: InteractionRouter,
    private readonly tracer: Tracer,
    private readonly logger: Logger,
  ) {
    super();
  }

  readonly eventType = Events.InteractionCreate;

  async handle(interaction: Interaction): Promise<void> {
    // Handle interaction with tracing
    await this.tracer.startActiveSpan(
      "event-handler.InteractionCreate",
      async (span: Span) => {
        await this.interactionRouter.handleAPIInteraction(interaction);
        await updateStat(StatName.CommandCount, 1, "add");

        span.end();
      },
    );
  }
}
