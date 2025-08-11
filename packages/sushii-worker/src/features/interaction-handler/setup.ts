import type { Tracer } from "@opentelemetry/api";
import opentelemetry from "@opentelemetry/api";
import type { Logger } from "pino";

import type InteractionRouter from "@/core/cluster/discord/InteractionRouter";
import type { BaseFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { InteractionCreateHandler } from "./presentation/events/InteractionCreateHandler";

interface InteractionHandlerDependencies {
  interactionRouter: InteractionRouter;
  logger: Logger;
}

export function setupInteractionHandlerFeature({
  interactionRouter,
  logger,
}: InteractionHandlerDependencies): BaseFeatureSetupReturn {
  // Create OpenTelemetry tracer for interaction handling
  const tracer: Tracer = opentelemetry.trace.getTracer("interaction-handler");

  const eventHandlers = [
    new InteractionCreateHandler(
      interactionRouter,
      tracer,
      logger.child({ component: "InteractionHandler" }),
    ),
  ];

  return {
    commands: [],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers,
  };
}
