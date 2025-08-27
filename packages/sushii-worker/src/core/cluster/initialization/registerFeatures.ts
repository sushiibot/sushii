import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
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
import { setupReactionLog } from "@/features/reaction-log/setup";
import { setupRemindersFeature } from "@/features/reminders/setup";
import { setupRoleMenuFeature } from "@/features/role-menu/setup";
import { setupSocialFeature } from "@/features/social/setup";
import { setupStatsFeature } from "@/features/stats/setup";
import { setupStatusFeature } from "@/features/status/setup";
import { setupTagFeature } from "@/features/tags/setup";
import { setupUserProfileFeature } from "@/features/user-profile/setup";
import { setupWebhookLoggingFeature } from "@/features/webhook-logging/setup";
import type * as schema from "@/infrastructure/database/schema";
import logger from "@/shared/infrastructure/logger";

import type InteractionRouter from "../discord/InteractionRouter";
import type { EventHandler, EventType } from "../presentation/EventHandler";
import { registerTasks } from "./registerTasks";

const tracer = opentelemetry.trace.getTracer("feature-event-handler");

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

function extractGuildIdFromEvent(args: unknown[]): string | undefined {
  // Check for common guild-related events
  if (args.length > 0) {
    const firstArg = args[0];
    if (firstArg && typeof firstArg === "object" && "guildId" in firstArg) {
      return (firstArg as { guildId?: string }).guildId;
    }

    if (firstArg && typeof firstArg === "object" && "guild" in firstArg) {
      return (firstArg as { guild?: { id?: string } }).guild?.id;
    }
  }
  return undefined;
}

function extractUserIdFromEvent(args: unknown[]): string | undefined {
  // Check for user-related events
  if (args.length > 0) {
    const firstArg = args[0];
    if (firstArg && typeof firstArg === "object") {
      // Direct user property
      if ("user" in firstArg) {
        return (firstArg as { user?: { id?: string } }).user?.id;
      }

      // Author property (for messages)
      if ("author" in firstArg) {
        return (firstArg as { author?: { id?: string } }).author?.id;
      }

      // Member property
      if ("member" in firstArg) {
        const member = (
          firstArg as { member?: { user?: { id?: string }; id?: string } }
        ).member;
        return member?.user?.id || member?.id;
      }
    }
  }
  return undefined;
}

async function handleDiscordEvent(
  eventType: string,
  group: EventHandler<EventType>[],
  deploymentService: DeploymentService,
  args: unknown[],
): Promise<void> {
  // Extract all context once at the beginning (outside of spans)
  const channelId = extractChannelIdFromEvent(eventType, args);
  const guildId = extractGuildIdFromEvent(eventType, args);
  const userId = extractUserIdFromEvent(eventType, args);
  const isDeploymentActive =
    deploymentService.isCurrentDeploymentActive(channelId);

  const promises = [];

  for (const handler of group) {
    // Skip non-exempt handlers when deployment is inactive
    if (!handler.isExemptFromDeploymentCheck && !isDeploymentActive) {
      continue;
    }

    // Handler is either exempt OR deployment is active
    const p = tracer.startActiveSpan(
      `${eventType}.${handler.constructor.name}`,
      async (span) => {
        try {
          // Set basic attributes
          span.setAttributes({
            "event.type": eventType,
            "handler.name": handler.constructor.name,
            "handler.exempt": handler.isExemptFromDeploymentCheck ?? false,
            "deployment.active": isDeploymentActive,
          });

          // Add pre-extracted context attributes
          if (channelId) {
            span.setAttribute("channel.id", channelId);
          }
          if (guildId) {
            span.setAttribute("guild.id", guildId);
          }
          if (userId) {
            span.setAttribute("user.id", userId);
          }

          return await handler.handle(
            ...(args as Parameters<typeof handler.handle>),
          );
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : "Unknown error",
          });

          // Log the error with context
          logger.error(
            {
              error,
              eventType,
              handler: handler.constructor.name,
              channelId,
              guildId,
              userId,
            },
            `Error in handler ${handler.constructor.name} for event ${eventType}`,
          );

          throw error;
        } finally {
          span.end();
        }
      },
    );

    promises.push(p);
  }

  // Run all handlers that should execute
  await Promise.allSettled(promises);
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
  const cacheFeature = createCacheFeature({ logger, db });

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
  const statusFeature = setupStatusFeature({ db });
  const remindersFeature = setupRemindersFeature({
    db,
    client,
    deploymentService,
    logger: logger.child({ feature: "Reminders" }),
  });
  const roleMenuFeature = setupRoleMenuFeature({
    db,
    logger: logger.child({ feature: "RoleMenu" }),
  });
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
  const legacyAuditLogsFeature = setupLegacyAuditLogsFeature({
    guildConfigRepository:
      guildSettingsFeature.services.guildConfigurationRepository,
    logger,
  });

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

  // Reaction log feature
  const reactionLogFeature = setupReactionLog(
    db,
    client,
    guildSettingsFeature.services.guildConfigurationRepository,
    deploymentService,
    logger.child({ component: "ReactionLogFeature" }),
  );

  // Register commands and handlers on interaction router
  interactionRouter.addCommands(
    ...levelingFeature.commands,
    ...tagFeature.commands,
    ...userProfileFeature.commands,
    ...socialFeature.commands,
    ...notificationFeature.commands,
    ...guildSettingsFeature.commands,
    ...remindersFeature.commands,
    ...roleMenuFeature.commands,
    ...moderationFeature.commands,
    ...giveawayFeature.commands,
    ...emojiStatsFeature.commands,
    ...statusFeature.commands,
  );
  interactionRouter.addAutocompleteHandlers(
    ...levelingFeature.autocompletes,
    ...tagFeature.autocompletes,
    ...userProfileFeature.autocompletes,
    ...socialFeature.autocompletes,
    ...notificationFeature.autocompletes,
    ...guildSettingsFeature.autocompletes,
    ...remindersFeature.autocompletes,
    ...roleMenuFeature.autocompletes,
    ...moderationFeature.autocompletes,
    ...giveawayFeature.autocompletes,
    ...emojiStatsFeature.autocompletes,
  );

  // Context menu handlers
  interactionRouter.addContextMenus(
    ...moderationFeature.contextMenuHandlers,
    ...reactionLogFeature.contextMenuHandlers,
  );

  // Button handlers
  interactionRouter.addButtons(
    ...levelingFeature.buttonHandlers,
    ...tagFeature.buttonHandlers,
    ...userProfileFeature.buttonHandlers,
    ...socialFeature.buttonHandlers,
    ...notificationFeature.buttonHandlers,
    ...guildSettingsFeature.buttonHandlers,
    ...remindersFeature.buttonHandlers,
    ...roleMenuFeature.buttonHandlers,
    ...moderationFeature.buttonHandlers,
    ...giveawayFeature.buttonHandlers,
    ...emojiStatsFeature.buttonHandlers,
  );

  // Select menu handlers
  interactionRouter.addSelectMenus(...roleMenuFeature.selectMenuHandlers);

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
    ...reactionLogFeature.eventHandlers,
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
        await handleDiscordEvent(eventType, group, deploymentService, args);
      } catch (error) {
        logger.error(
          {
            error,
            eventType,
            handlers: group.map((h) => h.constructor.name),
          },
          `Unexpected error handling event ${eventType}`,
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
    ...reactionLogFeature.tasks,
    ...statsFeature.tasks,
    ...remindersFeature.tasks,
  ];

  registerTasks(client, featureTasks);

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
