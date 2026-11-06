import type { ProductEventTracker } from "@/features/product-analytics/domain/ProductEvent";
import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { CommandMentions } from "@/shared/presentation/commandMentions";

import { SushiiUpdatesCaptureService } from "./application/SushiiUpdatesCaptureService";
import { SushiiUpdatesRelayService } from "./application/SushiiUpdatesRelayService";
import { DrizzleSushiiUpdatesRepository } from "./infrastructure/DrizzleSushiiUpdatesRepository";
import { SushiiUpdatesMetrics } from "./infrastructure/SushiiUpdatesMetrics";
import { SushiiUpdatesRelayTask } from "./infrastructure/tasks/SushiiUpdatesRelayTask";
import { UpdatesPublishHandler } from "./presentation/events/UpdatesPublishHandler";

interface SushiiUpdatesDependencies {
  client: Client;
  db: NodePgDatabase<typeof schema>;
  deploymentService: DeploymentService;
  commandMentions: CommandMentions;
  logger: Logger;
  /** Unset turns the whole feature off. */
  sourceChannelId: string | undefined;
  productEvents: ProductEventTracker;
}

export function setupSushiiUpdatesFeature({
  client,
  db,
  deploymentService,
  commandMentions,
  logger,
  sourceChannelId,
  productEvents,
}: SushiiUpdatesDependencies) {
  if (!sourceChannelId) {
    return { available: false, eventHandlers: [], tasks: [] };
  }

  const repository = new DrizzleSushiiUpdatesRepository(db);
  const metrics = new SushiiUpdatesMetrics();
  const capture = new SushiiUpdatesCaptureService(
    repository,
    metrics,
    logger.child({ component: "SushiiUpdatesCaptureService" }),
  );
  const relay = new SushiiUpdatesRelayService(
    client.rest,
    sourceChannelId,
    repository,
    metrics,
    commandMentions,
    logger.child({ component: "SushiiUpdatesRelayService" }),
    undefined,
    productEvents,
  );

  return {
    available: true,
    eventHandlers: [new UpdatesPublishHandler(sourceChannelId, capture)],
    tasks: [
      new SushiiUpdatesRelayTask(
        client,
        deploymentService,
        logger.child({ component: "SushiiUpdatesRelayTask" }),
        sourceChannelId,
        relay,
      ),
    ],
  };
}
