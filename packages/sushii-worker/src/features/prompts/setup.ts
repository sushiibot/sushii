import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import type { BaseFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { PromptService } from "./application/PromptService";
import { ALL_PROMPTS } from "./definitions";
import { DrizzlePromptStateRepository } from "./infrastructure/DrizzlePromptStateRepository";
import { PromptEventHandler } from "./presentation/events/PromptEventHandler";
import { PromptButtonHandler } from "./presentation/handlers/PromptButtonHandler";

interface PromptsDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

export function setupPromptsFeature({
  db,
  logger,
}: PromptsDependencies): BaseFeatureSetupReturn {
  const repository = new DrizzlePromptStateRepository(db);
  const service = new PromptService(
    repository,
    ALL_PROMPTS,
    logger.child({ feature: "Prompts" }),
  );

  return {
    commands: [],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [
      new PromptButtonHandler(service, logger.child({ module: "promptButton" })),
    ],
    eventHandlers: [new PromptEventHandler(service)],
  };
}
