import type { Logger } from "pino";

import type InteractionRouter from "@/core/cluster/discord/InteractionRouter";
import type { StatsService } from "@/features/stats";
import type { BaseFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { InteractionCreateHandler } from "./presentation/events/InteractionCreateHandler";

interface InteractionHandlerDependencies {
  interactionRouter: InteractionRouter;
  statsService: StatsService;
  logger: Logger;
}

export function setupInteractionHandlerFeature({
  interactionRouter,
  statsService,
}: InteractionHandlerDependencies): BaseFeatureSetupReturn {
  const eventHandlers = [
    new InteractionCreateHandler(interactionRouter, statsService),
  ];

  return {
    commands: [],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers,
  };
}
