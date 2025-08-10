import type { Span } from "@opentelemetry/api";
import opentelemetry from "@opentelemetry/api";
import * as Sentry from "@sentry/node";
import type { Client, ClientEvents, GatewayDispatchPayload } from "discord.js";
import { Events, GatewayDispatchEvents } from "discord.js";

import {
  emojiAndStickerStatsReadyHandler,
  emojiStatsMsgHandler,
  emojiStatsReactHandler,
} from "@/events/EmojiStatsHandler";
import type { EventHandlerFn } from "@/events/EventHandler";
import legacyModLogNotifierHandler from "@/events/GuildBanAdd/LegacyModLogNotifier";
// Member event handlers migrated to DDD architecture (member-events feature)
// Legacy mod log handler removed - migrated to DDD architecture
import msgLogCacheHandler from "@/events/msglog/MessageCacheHandler";
import { msgLogHandler } from "@/events/msglog/MsgLogHandler";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { updateGatewayDispatchEventMetrics } from "@/infrastructure/metrics/gatewayMetrics";
import { config } from "@/shared/infrastructure/config";
import logger from "@/shared/infrastructure/logger";
import { StatName, updateStat } from "@/tasks/StatsTask";

import type InteractionClient from "./InteractionRouter";

// import { mentionTagHandler } from "./events/TagsMention";

const tracerName = "event-handler";
const tracer = opentelemetry.trace.getTracer(tracerName);
const prefixSpanName = (name: string): string => `${tracerName}.${name}`;

async function handleEvent<K extends keyof ClientEvents>(
  eventType: K,
  handlers: Record<string, EventHandlerFn<K>>,
  ...args: ClientEvents[K]
): Promise<void> {
  // Use handlerNames for iteration to preserve order
  const handlerNames = Object.keys(handlers);

  // Same order as handlerNames
  const results = await Promise.allSettled(
    handlerNames.map((name) => handlers[name](...args)),
  );

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const handlerName = handlerNames[i];

    if (result.status === "rejected") {
      Sentry.captureException(result.reason, {
        tags: {
          type: "event",
          event: eventType,
          // Track which handler failed
          handlerName,
        },
      });

      logger.error(
        {
          err: result.reason,
          handlerName,
        },
        "error handling event %s",
        eventType,
      );
    }
  }
}

async function runParallel(
  eventType: string,
  promises: Promise<void>[],
): Promise<void> {
  const results = await Promise.allSettled(promises);

  for (const result of results) {
    if (result.status === "rejected") {
      Sentry.captureException(result.reason, {
        tags: {
          type: "event",
          event: eventType,
        },
      });

      logger.error(
        { err: result.reason },
        "error handling event %s",
        eventType,
      );
    }
  }
}

export default function registerEventHandlers(
  client: Client,
  interactionHandler: InteractionClient,
  deploymentService: DeploymentService,
): void {
  client.once(Events.ClientReady, async (c) => {
    logger.info(
      {
        clusterId: c.cluster.id,
        shardIds: c.cluster.shardList,
        botUser: c.user.tag,
        deployment: config.deployment.name,
      },
      "Cluster client ready!",
    );

    // Tasks are now started in bootstrap.ts during feature registration

    await tracer.startActiveSpan(
      prefixSpanName(Events.ClientReady),
      async (span: Span) => {
        // Check to make Client<true> instead of Client<bool>
        if (client.isReady()) {
          await handleEvent(
            Events.ClientReady,
            {
              emojiAndStickerStatsReady: emojiAndStickerStatsReadyHandler,
            },
            client,
          );
        }

        span.end();
      },
    );
  });

  client.on(Events.Debug, async (msg) => {
    logger.debug(msg);
  });

  client.on(Events.ShardReady, async (shardId, unavailableGuilds) => {
    logger.info(
      {
        shardId,
        unavailableGuilds,
      },
      "Shard ready",
    );
  });

  client.on(Events.ShardDisconnect, async (closeEvent, shardId) => {
    logger.info(
      {
        shardId,
        event: closeEvent,
      },
      "Shard disconnected",
    );
  });

  client.on(Events.ShardError, async (error, shardId) => {
    logger.error(
      {
        shardId,
        error,
      },
      "Shard error",
    );
  });

  client.on(Events.ShardReconnecting, async (shardId) => {
    logger.info(
      {
        shardId,
      },
      "Shard reconnecting",
    );
  });

  client.on(Events.ShardResume, async (shardId, replayedEvents) => {
    logger.info(
      {
        shardId,
        replayedEvents,
      },
      "Shard resumed",
    );
  });

  client.on(Events.GuildCreate, async (guild) => {
    logger.info(
      {
        guildId: guild.id,
      },
      "Joined guild %s",
      guild.name,
    );

    if (!deploymentService.isCurrentDeploymentActive()) {
      return;
    }
  });

  client.on(Events.GuildDelete, async (guild) => {
    logger.info(
      {
        guildId: guild.id,
      },
      "Removed guild %s",
      guild.name,
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!deploymentService.isCurrentDeploymentActive(interaction.channelId)) {
      return;
    }

    await tracer.startActiveSpan(
      prefixSpanName(Events.InteractionCreate),
      async (span: Span) => {
        await interactionHandler.handleAPIInteraction(interaction);
        await updateStat(StatName.CommandCount, 1, "add");

        span.end();
      },
    );
  });

  client.on(Events.GuildBanAdd, async (guildBan) => {
    if (!deploymentService.isCurrentDeploymentActive()) {
      return;
    }

    await tracer.startActiveSpan(
      prefixSpanName(Events.GuildBanAdd),
      async (span: Span) => {
        const handlers: Record<string, EventHandlerFn<Events.GuildBanAdd>> = {
          legacyModLogNotifier: legacyModLogNotifierHandler,
        };

        await handleEvent(Events.GuildBanAdd, handlers, guildBan);

        span.end();
      },
    );
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (!deploymentService.isCurrentDeploymentActive(msg.channelId)) {
      return;
    }

    await tracer.startActiveSpan(
      prefixSpanName(Events.MessageCreate),
      async (span: Span) => {
        await handleEvent(
          Events.MessageCreate,
          {
            emojiStats: emojiStatsMsgHandler,
          },
          msg,
        );

        span.end();
      },
    );
  });

  client.on(Events.MessageReactionAdd, async (reaction, user, details) => {
    if (
      !deploymentService.isCurrentDeploymentActive(reaction.message.channelId)
    ) {
      return;
    }

    await tracer.startActiveSpan(
      prefixSpanName(Events.MessageReactionAdd),
      async (span: Span) => {
        await handleEvent(
          Events.MessageReactionAdd,
          { emojiStatsReact: emojiStatsReactHandler },
          reaction,
          user,
          details,
        );

        span.end();
      },
    );
  });

  client.on(Events.Raw, async (event: GatewayDispatchPayload) => {
    updateGatewayDispatchEventMetrics(event.t);

    if (!deploymentService.isCurrentDeploymentActive()) {
      return;
    }

    await tracer.startActiveSpan(
      prefixSpanName(Events.Raw),
      async (span: Span) => {
        if (event.t === GatewayDispatchEvents.MessageDelete) {
          await runParallel(event.t, [msgLogHandler(client, event.t, event.d)]);
        }

        if (event.t === GatewayDispatchEvents.MessageDeleteBulk) {
          await runParallel(event.t, [msgLogHandler(client, event.t, event.d)]);
        }

        if (event.t === GatewayDispatchEvents.MessageUpdate) {
          try {
            // Log first to keep old message, then cache after for new update.
            // Fine to await since each event is a specific type, no other types that
            // this blocks.
            await msgLogHandler(client, event.t, event.d);
            await msgLogCacheHandler(client, event.t, event.d);
          } catch (err) {
            Sentry.captureException(err, {
              tags: {
                event: "MessageUpdate",
              },
            });

            logger.error(
              {
                err,
                event,
              },
              "error handling event %s",
              event.t,
            );
          }
        }

        if (event.t === GatewayDispatchEvents.MessageCreate) {
          await runParallel(event.t, [
            msgLogCacheHandler(client, event.t, event.d),
          ]);
        }

        span.end();
      },
    );
  });

  logger.info("Registered Discord.js event handlers");
}
