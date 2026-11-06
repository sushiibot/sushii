import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";

import { PromptService } from "./application/PromptService";
import { ALL_PROMPTS } from "./definitions";
import { DrizzlePromptStateRepository } from "./infrastructure/DrizzlePromptStateRepository";
import { PromptMetrics } from "./infrastructure/PromptMetrics";
import type { ProductEventTracker } from "@/features/product-analytics/domain/ProductEvent";

import {
  PromptButtonHandler,
  PromptSelectMenuHandler,
} from "./presentation/handlers/PromptButtonHandler";

interface PromptsDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
  productEvents: ProductEventTracker;
}

export function setupPromptsFeature({
  db,
  logger,
  productEvents,
}: PromptsDependencies) {
  const service = new PromptService(
    new DrizzlePromptStateRepository(db),
    ALL_PROMPTS,
    new PromptMetrics(),
    logger.child({ feature: "Prompts" }),
    undefined,
    productEvents,
  );

  return {
    services: { promptService: service },
    buttonHandlers: [new PromptButtonHandler(service)],
    selectMenuHandlers: [new PromptSelectMenuHandler(service)],
  };
}
