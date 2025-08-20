import * as Sentry from "@sentry/node";
import { ClusterClient, getInfo } from "discord-hybrid-sharding";
import { Client, GatewayIntentBits, Options, Partials } from "discord.js";

import { config } from "@/shared/infrastructure/config";
import { initializeOtel } from "@/shared/infrastructure/opentelemetry/otel";

import registerLegacyInteractionHandlers from "../../interactions/commands";
import "../../shared/domain/dayjs";
import initI18next from "../../shared/infrastructure/i18next";
import log from "../../shared/infrastructure/logger";
import { initCore } from "./initialization/initCore";
import { initStandaloneServices } from "./initialization/initStandaloneServices";
import { registerFeatures } from "./initialization/registerFeatures";

Error.stackTraceLimit = 50;

async function initializeShardCluster(): Promise<void> {
  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    tracesSampleRate: 1.0,
  });

  const clusterInfo = getInfo();

  // Per-process otel instrumentation
  const otelSdk = initializeOtel(log, clusterInfo.CLUSTER);

  await initI18next();

  // Create a new client instance
  const client = new Client({
    // Hybrid sharding options
    shards: clusterInfo.SHARD_LIST, // Array of shards that will be spawned
    shardCount: clusterInfo.TOTAL_SHARDS, // Total number of shards

    // Base options
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildExpressions,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.GuildMember],
    rest: {
      version: "10",
      // Optional proxy URL
      ...(config.discord.proxyUrl
        ? {
            api: config.discord.proxyUrl,
          }
        : {}),
    },
    makeCache: Options.cacheWithLimits({
      MessageManager: 0,
      UserManager: 0,
    }),
  });

  client.cluster = new ClusterClient(client);
  client.rest.setToken(config.discord.token);

  // Telemetry - will register after client login

  // START NEW REGISTRATION
  const { db, deploymentService, interactionRouter, coreMetrics } =
    await initCore(client);

  // Register shard metrics now that client is logged in
  coreMetrics.registerShardCallbacks(client);

  registerLegacyInteractionHandlers(interactionRouter);

  // New registration of features -- also adds commands to the router and starts tasks
  registerFeatures(db, client, deploymentService, interactionRouter);

  // AFTER features are registered (includes registering commands)

  // Only commands register on client including shard 0
  if (
    !config.features.skipCommandRegistration &&
    client.cluster.shardList.includes(0)
  ) {
    log.info("registering interaction handlers on shard 0");
    await interactionRouter.register();
  } else {
    log.info(
      {
        skip: config.features.skipCommandRegistration,
        shardList: client.cluster.shardList,
      },
      "skipping interaction handler registration on cluster",
    );
  }

  process.on("SIGTERM", async () => {
    log.info("SIGTERM received, shutting down shard gracefully");
    try {
      await deploymentService.stop();
      await client.destroy();
      await Sentry.close(2000);

      // Force flush metrics before shutdown to ensure they're exported
      log.info("Flushing metrics before shutdown");
      await otelSdk.shutdown();
      log.info("OTEL SDK shutdown complete");
    } catch (err) {
      log.error(err, "error shutting down shard");
    }
    process.exit(0);
  });

  log.info(
    {
      shards: client.cluster.shardList,
      mode: client.cluster.mode,
    },
    "starting Discord client shard cluster",
  );
  await client.login(config.discord.token);

  // Initialize standalone services that don't depend on other features
  await initStandaloneServices(db, client, log, deploymentService);
}

initializeShardCluster().catch((err) => {
  Sentry.captureException(err, {
    level: "fatal",
  });

  log.error({ err }, "fatal error in shard");
  process.exit(1);
});
