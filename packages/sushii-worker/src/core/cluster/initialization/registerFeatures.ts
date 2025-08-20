import type { Client } from "discord.js";
import { Events, Message } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { setupBanCacheFeature } from "@/features/ban-cache/setup";
import { setupBotEmojiFeature } from "@/features/bot-emojis/setup";
import { createCacheFeature } from "@/features/cache/setup";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { DeploymentEventHandler } from "@/features/deployment/presentation/DeploymentEventHandler";
import { setupEmojiStatsFeature } from "@/features/emoji-stats/setup";
import { setupGiveawayFeature } from "@/features/giveaways/setup";
import { setupGuildSettingsFeature } from "@/features/guild-settings/setup";
import { setupInteractionHandlerFeature } from "@/features/interaction-handler/setup";
import { setupLegacyAuditLogsFeature } from "@/features/legacy-audit-logs/setup";
import { setupLevelingFeature } from "@/features/leveling/setup";
import { setupMemberEventsFeature } from "@/features/member-events/setup";
import { setupMessageLog } from "@/features/message-log/setup";
import { setupModerationFeature } from "@/features/moderation/setup";
import { setupNotificationFeature } from "@/features/notifications/setup";
import { setupSocialFeature } from "@/features/social/setup";
import { setupStatsFeature } from "@/features/stats/setup";
import { setupTagFeature } from "@/features/tags/setup";
import { setupUserProfileFeature } from "@/features/user-profile/setup";
import { setupWebhookLoggingFeature } from "@/features/webhook-logging/setup";
import type * as schema from "@/infrastructure/database/schema";
import logger from "@/shared/infrastructure/logger";

import type InteractionRouter from "../discord/InteractionRouter";
import type { EventHandler, EventType } from "../presentation/EventHandler";
import { registerTasks } from "../tasks/registerTasks";

// Extract channelId from event arguments based on event type
function extractChannelIdFromEvent(
  eventType: string,
  args: unknown[],
): string | undefined {
  // Check for MessageCreate events
  if (eventType === Events.MessageCreate && args.length > 0) {
    const firstArg = args[0];
    if (firstArg instanceof Message) {
      return firstArg.channelId;
    }
  }

  return undefined;
}

export function registerFeatures(
  db: NodePgDatabase<typeof schema>,
  client: Client,
  deploymentService: DeploymentService,
  interactionRouter: InteractionRouter,
) {
  // --------------------------------------------------------------------------
  // Build commands

  // Webhook logging feature
  const webhookLoggingFeature = setupWebhookLoggingFeature({
    logger,
    deploymentService,
  });

  // Bot emoji feature, used by other features for custom emojis
  const botEmojiFeature = setupBotEmojiFeature({
    db,
    client,
    logger: logger.child({ feature: "BotEmoji" }),
    webhookService: webhookLoggingFeature.services.webhookService,
  });

  // Cache feature
  const cacheFeature = createCacheFeature({ db });

  // Stats feature (setup early so other features can use it)
  const statsFeature = setupStatsFeature({
    db,
    logger,
    client,
    deploymentService,
  });

  // Interaction handler feature -- commands, etc.
  const interactionHandlerFeature = setupInteractionHandlerFeature({
    interactionRouter,
    statsService: statsFeature.services.statsService,
    logger,
  });

  const banCacheFeature = setupBanCacheFeature({ db, logger });
  const levelingFeature = setupLevelingFeature({ db, logger });
  const tagFeature = setupTagFeature({ db, logger });
  const userProfileFeature = setupUserProfileFeature({ db, client, logger });
  const socialFeature = setupSocialFeature({ db, client, logger });
  const notificationFeature = setupNotificationFeature({ db, logger });
  const guildSettingsFeature = setupGuildSettingsFeature({ db, logger });
  const memberEventsFeature = setupMemberEventsFeature({ db, logger });
  const moderationFeature = setupModerationFeature({
    db,
    client,
    logger,
    deploymentService,
    emojiRepository: botEmojiFeature.services.botEmojiRepository,
  });
  const giveawayFeature = setupGiveawayFeature({
    db,
    userLevelRepository: levelingFeature.services.userLevelRepository,
    logger,
    client,
    deploymentService,
  });

  // Legacy audit logs feature
  const legacyAuditLogsFeature = setupLegacyAuditLogsFeature({ logger });

  // Emoji stats feature
  const emojiStatsFeature = setupEmojiStatsFeature({
    db,
    client,
    deploymentService,
  });

  // Message log feature
  const messageLogFeature = setupMessageLog(
    client,
    db,
    guildSettingsFeature.services.guildConfigurationRepository,
    deploymentService,
    logger.child({ component: "MessageLogFeature" }),
  );

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
    ...emojiStatsFeature.commands,
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
    ...emojiStatsFeature.autocompletes,
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
    ...emojiStatsFeature.buttonHandlers,
  );

  // ---------------------------------------------------------------------------
  // Build event handlers

  // Deployment handler
  const deploymentHandler = new DeploymentEventHandler(
    deploymentService,
    logger,
  );

  const handlers = [
    ...botEmojiFeature.eventHandlers, // Early in the list for startup sync
    ...interactionHandlerFeature.eventHandlers,
    ...levelingFeature.eventHandlers,
    deploymentHandler,
    ...notificationFeature.eventHandlers,
    ...memberEventsFeature.eventHandlers,
    ...moderationFeature.eventHandlers,
    ...cacheFeature.eventHandlers,
    ...banCacheFeature.eventHandlers,
    ...webhookLoggingFeature.eventHandlers,
    ...legacyAuditLogsFeature.eventHandlers,
    ...emojiStatsFeature.eventHandlers,
    ...messageLogFeature.eventHandlers,
  ];

  // ---------------------------------------------------------------------------
  // Register feature event handlers

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
    logger.trace(
      {
        eventType,
        handlerNames: group.map((h) => h.constructor.name),
        count: group.length,
      },
      `Registering event handler`,
    );

    client.on(eventType, async (...args) => {
      try {
        // Check deployment status once per event
        const channelId = extractChannelIdFromEvent(eventType, args);
        const isDeploymentActive =
          deploymentService.isCurrentDeploymentActive(channelId);

        // Track which handlers execute and their promise indices
        const executedHandlers: {
          handler: EventHandler<EventType>;
          promiseIndex: number;
        }[] = [];
        const promises = [];
        let promiseIndex = 0;

        for (const handler of group) {
          // Skip non-exempt handlers when deployment is inactive
          if (!handler.isExemptFromDeploymentCheck && !isDeploymentActive) {
            continue;
          }

          // Handler is either exempt OR deployment is active
          executedHandlers.push({ handler, promiseIndex });
          // TODO: Add trace span here
          const p = handler.handle(...args);
          promises.push(p);
          promiseIndex++;
        }

        // Run all handlers that should execute
        const results = await Promise.allSettled(promises);

        // Log any errors that occurred in the handlers
        for (const { handler, promiseIndex: index } of executedHandlers) {
          const result = results[index];
          if (result && result.status === "rejected") {
            logger.error(
              {
                error: result.reason,
                eventType,
                handler: handler.constructor.name,
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

  const featureTasks = [
    ...giveawayFeature.tasks,
    ...moderationFeature.tasks,
    ...emojiStatsFeature.tasks,
    ...messageLogFeature.tasks,
    ...statsFeature.tasks,
  ];

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
    botEmojiRepository: botEmojiFeature.services.botEmojiRepository,
  };
}
