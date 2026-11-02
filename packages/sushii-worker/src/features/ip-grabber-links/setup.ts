import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import { SushiiNotificationService } from "@/shared/infrastructure/SushiiNotificationService";

import { IpGrabberDetector } from "./application/IpGrabberDetector";
import { IpGrabberDiscoveryService } from "./application/IpGrabberDiscoveryService";
import { IpGrabberMaintenanceService } from "./application/IpGrabberMaintenanceService";
import { IpGrabberReviewService } from "./application/IpGrabberReviewService";
import { IpGrabberSyncService } from "./application/IpGrabberSyncService";
import { DrizzleIpGrabberRepository } from "./infrastructure/DrizzleIpGrabberRepository";
import { IpGrabberMetrics } from "./infrastructure/IpGrabberMetrics";
import {
  FetchRedirectProbe,
  NodeDnsLookup,
} from "./infrastructure/NodeDnsLookup";
import { IpGrabberMaintenanceTask } from "./infrastructure/tasks/IpGrabberMaintenanceTask";
import { IpGrabberReviewPostTask } from "./infrastructure/tasks/IpGrabberReviewPostTask";
import { IpGrabberSyncTask } from "./infrastructure/tasks/IpGrabberSyncTask";
import { IpGrabberLinkHandler } from "./presentation/events/IpGrabberLinkHandler";
import { IpGrabberRevertButtonHandler } from "./presentation/handlers/IpGrabberRevertButtonHandler";

export interface IpGrabberLinksFeatureOptions {
  client: Client;
  db: NodePgDatabase<typeof schema>;
  guildConfigRepository: GuildConfigRepository;
  deploymentService: DeploymentService;
  logger: Logger;
  discoveryEnabled: boolean;
}

export function setupIpGrabberLinksFeature(
  options: IpGrabberLinksFeatureOptions,
) {
  const {
    client,
    db,
    guildConfigRepository,
    deploymentService,
    logger,
    discoveryEnabled,
  } = options;

  const repository = new DrizzleIpGrabberRepository(db);
  const metrics = new IpGrabberMetrics();
  const detector = new IpGrabberDetector(
    new NodeDnsLookup(),
    new FetchRedirectProbe(),
  );
  const notifications = new SushiiNotificationService(
    client,
    guildConfigRepository,
    logger.child({ component: "SushiiNotificationService" }),
  );

  const syncService = new IpGrabberSyncService(
    client,
    repository,
    notifications,
    metrics,
    logger.child({ component: "IpGrabberSyncService" }),
  );
  const maintenanceService = new IpGrabberMaintenanceService(
    repository,
    detector,
    metrics,
    logger.child({ component: "IpGrabberMaintenanceService" }),
  );
  const reviewService = new IpGrabberReviewService(
    client,
    repository,
    logger.child({ component: "IpGrabberReviewService" }),
  );

  const eventHandlers = discoveryEnabled
    ? [
        new IpGrabberLinkHandler(
          new IpGrabberDiscoveryService(
            client,
            repository,
            detector,
            metrics,
            logger.child({ component: "IpGrabberDiscoveryService" }),
          ),
          logger.child({ component: "IpGrabberLinkHandler" }),
        ),
      ]
    : [];

  const taskLogger = (name: string) => logger.child({ component: name });

  return {
    services: { settingsPort: syncService },
    eventHandlers,
    buttonHandlers: [new IpGrabberRevertButtonHandler(reviewService)],
    tasks: [
      new IpGrabberSyncTask(
        client,
        deploymentService,
        taskLogger("IpGrabberSyncTask"),
        repository,
        syncService,
      ),
      new IpGrabberMaintenanceTask(
        client,
        deploymentService,
        taskLogger("IpGrabberMaintenanceTask"),
        maintenanceService,
      ),
      new IpGrabberReviewPostTask(
        client,
        deploymentService,
        taskLogger("IpGrabberReviewPostTask"),
        reviewService,
      ),
    ],
  };
}
