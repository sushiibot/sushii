import { ClusterClient, getInfo } from "discord-hybrid-sharding";
import {
  Client,
  Events,
  GatewayIntentBits,
  Options,
  Partials,
} from "discord.js";

import { config, secrets } from "@/shared/infrastructure/config";
import { makeTracedDiscordRequest } from "@/shared/infrastructure/opentelemetry/discordRestTracing";
import { initializeOtel } from "@/shared/infrastructure/opentelemetry/otel";

import "../../shared/domain/dayjs";
import initI18next from "../../shared/infrastructure/i18next";
import log from "../../shared/infrastructure/logger";
import { initCore } from "./initialization/initCore";
import { initStandaloneServices } from "./initialization/initStandaloneServices";
import { registerFeatures } from "./initialization/registerFeatures";

Error.stackTraceLimit = 50;

async function initializeShardCluster(): Promise<void> {
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
      GatewayIntentBits.AutoModerationExecution,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User,
      Partials.GuildMember,
    ],
    rest: {
      version: "10",
      makeRequest: makeTracedDiscordRequest,
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
  client.rest.setToken(secrets.DISCORD_TOKEN);

  // Telemetry - will register after client login

  // START NEW REGISTRATION
  const { db, deploymentService, interactionRouter, coreMetrics } =
    await initCore(client, clusterInfo.CLUSTER);

  // Register shard metrics now that client is logged in
  coreMetrics.registerShardCallbacks(client);

  // Registered before login so READY / GUILD_CREATE dispatches are counted too
  coreMetrics.registerGatewayEventListener(client);

  // Register features -- adds commands to the router and starts tasks
  const features = registerFeatures(
    db,
    client,
    deploymentService,
    interactionRouter,
    interactionRouter.commandIdCache,
  );

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
    // Not awaited: prime() logs its own failures and must not delay login.
    void interactionRouter.commandIdCache.prime();
  }

  process.on("SIGTERM", async () => {
    log.info("SIGTERM received, shutting down shard gracefully");
    try {
      features.cleanup();
      await deploymentService.stop();
      await client.destroy();

      // Force flush metrics before shutdown to ensure they're exported
      log.info("Flushing metrics before shutdown");
      await otelSdk.shutdown();
      log.info("OTEL SDK shutdown complete");
    } catch (err) {
      log.error(err, "error shutting down shard");
    }
    process.exit(0);
  });

  // discord-hybrid-sharding v3: triggerReady() is no longer automatic,
  // must be called manually on the client ready event.
  client.once(Events.ClientReady, (readyClient) => {
    readyClient.cluster.triggerReady();
  });

  log.info(
    {
      shards: client.cluster.shardList,
      mode: client.cluster.mode,
    },
    "starting Discord client shard cluster",
  );
  await client.login(secrets.DISCORD_TOKEN);

  // Initialize standalone services that don't depend on other features
  await initStandaloneServices(db, client, log, deploymentService);
}

initializeShardCluster().catch((err) => {
  log.fatal({ err }, "fatal error in shard");
  process.exit(1);
});
