import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { DeploymentEventHandler } from "@/features/deployment/presentation/DeploymentEventHandler";
import { setupGiveawayFeature } from "@/features/giveaways/setup";
import { setupGuildSettingsFeature } from "@/features/guild-settings/setup";
import { setupLevelingFeature } from "@/features/leveling/setup";
import { setupMemberEventsFeature } from "@/features/member-events/setup";
import { setupModerationFeature } from "@/features/moderation/setup";
import { setupNotificationFeature } from "@/features/notifications/setup";
import { setupTagFeature } from "@/features/tags/setup";
import { setupSocialFeature } from "@/features/social/setup";
import { setupUserProfileFeature } from "@/features/user-profile/setup";
import { createCacheFeature } from "@/features/cache/setup";
import { setupBanCacheFeature } from "@/features/ban-cache/setup";
import { setupWebhookLoggingFeature } from "@/features/webhook-logging/setup";
import type * as schema from "@/infrastructure/database/schema";
import logger from "@/shared/infrastructure/logger";

import type InteractionRouter from "../discord/InteractionRouter";
import type { EventHandler } from "../presentation/EventHandler";
import { registerTasks } from "../tasks/registerTasks";

export function registerFeatures(
  db: NodePgDatabase<typeof schema>,
  client: Client,
  deploymentService: DeploymentService,
  interactionRouter: InteractionRouter,
) {
  // --------------------------------------------------------------------------
  // Build commands

  // Cache feature
  const cacheFeature = createCacheFeature({ db });

  // Ban cache feature
  const banCacheFeature = setupBanCacheFeature({ db, logger });

  // Leveling feature
  const levelingFeature = setupLevelingFeature({ db, logger });

  // Tags feature
  const tagFeature = setupTagFeature({ db, logger });

  // User profile feature
  const userProfileFeature = setupUserProfileFeature({ db, client, logger });

  // Social feature
  const socialFeature = setupSocialFeature({ db, client, logger });

  // Notification feature
  const notificationFeature = setupNotificationFeature({ db, logger });

  // Guild settings feature
  const guildSettingsFeature = setupGuildSettingsFeature({ db, logger });

  // Member events feature
  const memberEventsFeature = setupMemberEventsFeature({ db, logger });

  // Moderation feature
  const moderationFeature = setupModerationFeature({
    db,
    client,
    logger,
    deploymentService,
  });

  // Giveaway feature
  const giveawayFeature = setupGiveawayFeature({
    db,
    userLevelRepository: levelingFeature.services.userLevelRepository,
    logger,
    client,
    deploymentService,
  });

  // Webhook logging feature
  const webhookLoggingFeature = setupWebhookLoggingFeature({ logger });

  // Register commands and handlers on interaction router
  interactionRouter.addCommands(
    ...levelingFeature.commands,
    ...tagFeature.commands,
    ...userProfileFeature.commands,
    ...socialFeature.commands,
    ...notificationFeature.commands,
    ...guildSettingsFeature.commands,
    ...moderationFeature.commands,
    ...giveawayFeature.commands,
  );
  interactionRouter.addAutocompleteHandlers(
    ...levelingFeature.autocompletes,
    ...tagFeature.autocompletes,
    ...userProfileFeature.autocompletes,
    ...socialFeature.autocompletes,
    ...notificationFeature.autocompletes,
    ...guildSettingsFeature.autocompletes,
    ...moderationFeature.autocompletes,
    ...giveawayFeature.autocompletes,
  );

  // Context menu handlers
  moderationFeature.contextMenuHandlers.forEach((handler) => {
    interactionRouter.addContextMenu(handler);
  });

  // Button handlers
  interactionRouter.addButtons(
    ...levelingFeature.buttonHandlers,
    ...tagFeature.buttonHandlers,
    ...userProfileFeature.buttonHandlers,
    ...socialFeature.buttonHandlers,
    ...notificationFeature.buttonHandlers,
    ...guildSettingsFeature.buttonHandlers,
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
    ...memberEventsFeature.eventHandlers,
    ...moderationFeature.eventHandlers,
    ...cacheFeature.eventHandlers,
    ...banCacheFeature.eventHandlers,
    ...webhookLoggingFeature.eventHandlers,
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

  // ---------------------------------------------------------------------------
  // Register background tasks

  const featureTasks = [...giveawayFeature.tasks, ...moderationFeature.tasks];

  registerTasks(client, deploymentService, featureTasks);

  // Return services for backwards compatibility (can be removed later)
  return {
    giveawayServices: {
      giveawayService: giveawayFeature.services.giveawayService,
      giveawayDrawService: giveawayFeature.services.giveawayDrawService,
      giveawayEntryService: giveawayFeature.services.giveawayEntryService,
    },
    tempBanRepository: moderationFeature.services.tempBanRepository,
    webhookLoggingServices: webhookLoggingFeature.services,
  };
}
