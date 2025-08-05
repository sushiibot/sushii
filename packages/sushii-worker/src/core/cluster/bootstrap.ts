import { Client } from "discord.js";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

import { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { DeploymentChanged } from "@/features/deployment/domain/events/DeploymentChanged";
import { PostgreSQLDeploymentRepository } from "@/features/deployment/infrastructure/PostgreSQLDeploymentRepository";
import { DeploymentEventHandler } from "@/features/deployment/presentation/DeploymentEventHandler";
import { setupGuildSettingsFeature } from "@/features/guild-settings/setup";
import { setupLevelingFeature } from "@/features/leveling/setup";
import { setupModerationFeature } from "@/features/moderation/setup";
import { setupNotificationFeature } from "@/features/notifications/setup";
import { setupTagFeature } from "@/features/tags/setup";
import { setupGiveawayFeature } from "@/features/giveaways/setup";
import { drizzleDb } from "@/infrastructure/database/db";
import * as schema from "@/infrastructure/database/schema";
import { SimpleEventBus } from "@/shared/infrastructure/SimpleEventBus";
import { config } from "@/shared/infrastructure/config";
import logger from "@/shared/infrastructure/logger";

import InteractionRouter from "./discord/InteractionRouter";
import { EventHandler } from "./presentation/EventHandler";

export async function initCore() {
  // This just returns the global existing database for now, until we fully
  // integrate the database into the core
  const db = drizzleDb;

  // Create shared infrastructure
  const eventBus = new SimpleEventBus();

  // Initialize deployment service with direct database connection
  const deploymentRepository = new PostgreSQLDeploymentRepository(
    config.database.url,
    logger,
    eventBus,
    `sushii-deployment-${config.deployment.name}-shard-${process.env.SHARD_ID || "unknown"}`,
  );

  const deploymentService = new DeploymentService(
    deploymentRepository,
    logger,
    config.deployment.name,
    config.deployment,
  );

  // Subscribe to deployment changes
  eventBus.subscribe(DeploymentChanged, (event) => {
    deploymentService.handleDeploymentChanged(event);
  });

  await deploymentService.start();

  return {
    db,
    deploymentService,
    eventBus,
  };
}

export function registerFeatures(
  db: NodePgDatabase<typeof schema>,
  client: Client,
  deploymentService: DeploymentService,
  interactionRouter: InteractionRouter,
) {
  // --------------------------------------------------------------------------
  // Build commands

  // Leveling feature
  const levelingFeature = setupLevelingFeature({ db, logger });

  // Tags feature
  const tagFeature = setupTagFeature({ db, logger });

  // Notification feature
  const notificationFeature = setupNotificationFeature({ db, logger });

  // Guild settings feature
  const guildSettingsFeature = setupGuildSettingsFeature({ db, logger });

  // Moderation feature
  const moderationFeature = setupModerationFeature({
    db,
    client,
    logger,
  });

  // Giveaway feature
  const giveawayFeature = setupGiveawayFeature({
    db,
    userLevelRepository: levelingFeature.services.userLevelRepository,
    logger,
  });

  // Register commands and handlers on interaction router
  interactionRouter.addCommands(
    ...levelingFeature.commands,
    ...tagFeature.commands,
    ...notificationFeature.commands,
    ...guildSettingsFeature.commands,
    ...moderationFeature.commands,
    ...giveawayFeature.commands,
  );
  interactionRouter.addAutocompleteHandlers(
    ...tagFeature.autocompletes,
    ...notificationFeature.autocompletes,
    ...giveawayFeature.autocompletes,
  );

  // Context menu handlers
  if (moderationFeature.contextMenuHandlers) {
    moderationFeature.contextMenuHandlers.forEach((handler) => {
      interactionRouter.addContextMenu(handler);
    });
  }

  // Button handlers
  interactionRouter.addButtons(
    ...moderationFeature.buttonHandlers,
    ...giveawayFeature.buttonHandlers,
  );

  // ---------------------------------------------------------------------------
  // Build event handlers

  // Deployment handler
  const deploymentHandler = new DeploymentEventHandler(
    deploymentService,
    logger,
  );

  const handlers = [
    ...levelingFeature.eventHandlers,
    deploymentHandler,
    ...notificationFeature.eventHandlers,
    ...moderationFeature.eventHandlers,
  ];

  // ---------------------------------------------------------------------------
  // Register event handlers

  // Union type is too much for typescript, so we just use any here - it's
  // already type enforced in implementation, and the usage is fine
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlerGroups = new Map<string, EventHandler<any>[]>();

  // Group handlers by event type
  for (const handler of handlers) {
    const eventType = handler.eventType;

    if (!handlerGroups.has(eventType)) {
      handlerGroups.set(eventType, []);
    }

    const group = handlerGroups.get(eventType);
    if (group) {
      group.push(handler);
    }
  }

  // Build event listeners
  for (const [eventType, group] of handlerGroups.entries()) {
    logger.info(
      {
        eventType,
        handlerNames: group.map((h) => h.constructor.name),
        count: group.length,
      },
      `Registering event handler for ${eventType}`,
    );

    client.on(eventType, async (...args) => {
      try {
        // Check if deployment is active
        if (!deploymentService.isCurrentDeploymentActive()) {
          return;
        }

        const promises = [];

        for (const handler of group) {
          // TODO: Add trace span here
          const p = handler.handle(...args);
          promises.push(p);
        }
        // Run all handlers concurrently and wait for all to settle
        const results = await Promise.allSettled(promises);

        // Log any errors that occurred in the handlers
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result.status === "rejected") {
            logger.error(
              {
                error: result.reason,
                eventType,
                handler: group[i].constructor.name,
              },
              `Error in handler for event ${eventType}`,
            );
          }
        }
      } catch (error) {
        logger.error(
          {
            error,
            eventType,
            handlers: group.map((h) => h.constructor.name),
          },
          `Error handling event ${eventType}`,
        );
      }
    });
  }

  // Return giveaway services for use in tasks
  return {
    giveawayServices: {
      giveawayService: giveawayFeature.services.giveawayService,
      giveawayDrawService: giveawayFeature.services.giveawayDrawService,
      giveawayEntryService: giveawayFeature.services.giveawayEntryService,
    },
    tempBanRepository: moderationFeature.services.tempBanRepository,
  };
}
