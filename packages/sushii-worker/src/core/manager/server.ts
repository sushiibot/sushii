import type { Server } from "bun";
import type { Child, ClusterManager } from "discord-hybrid-sharding";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { routePath } from "hono/route";
import type { IncomingMessage, ServerResponse } from "node:http";

import { config } from "@/shared/infrastructure/config";
import { newModuleLogger } from "@/shared/infrastructure/logger";

// Reverse mapping of the Status enum to get the name
export const ShardStatusToName = {
  0: "Ready",
  1: "Connecting",
  2: "Reconnecting",
  3: "Idle",
  4: "Nearly",
  5: "Disconnected",
  6: "WaitingForGuilds",
  7: "Identifying",
  8: "Resuming",
};

const logger = newModuleLogger("http");

const pinoLoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const elapsedMs = Date.now() - start;

  const log = {
    method: c.req.method,
    path: routePath(c),
    status: c.res.status,
    elapsedMs,
  };

  const message = `${c.req.method} ${c.req.path} ${c.res.status} ${elapsedMs} ms`;
  logger.debug(log, message);
};

function createHealthServer(manager: ClusterManager): Server {
  const app = new Hono();

  // Middleware
  app.use("*", pinoLoggerMiddleware);

  // Routes
  app.get("/health", (c) => {
    // All clients are ready (1 client -> multiple shards)
    const allReady = Array.from(manager.clusters.values())
      .map((s) => s.ready)
      .every(Boolean);

    const statusCode = allReady ? 200 : 503;

    return c.json(
      {
        status: allReady ? "healthy" : "unhealthy",
        clusters: manager.clusters.values().map((cluster) => ({
          id: cluster.id,
          shards: cluster.shardList,
          ready: cluster.ready,
          restarts: {
            current: cluster.restarts.current,
            max: cluster.restarts.max,
            interval: cluster.restarts.interval,
          },
          process: {
            pid: (cluster.thread as Child)?.process?.pid,
            connected: (cluster.thread as Child)?.process?.connected,
          },
        })),
        shards: {
          total: manager.totalShards,
        },
      },
      statusCode,
    );
  });

  return Bun.serve({
    port: config.metrics.healthPort,
    fetch: app.fetch,
  });
}

interface MetricsBindings {
  incoming: IncomingMessage;
  outgoing: ServerResponse;
}

function createMonitoringServer(
  manager: ClusterManager,
  commands: RESTPostAPIApplicationCommandsJSONBody[],
): Server {
  const app = new Hono<{ Bindings: MetricsBindings }>();

  // Middleware
  app.use("*", pinoLoggerMiddleware);

  // Routes
  app.get("/commands", (c) => c.json(commands));
  app.get("/status", (c) => {
    const allReady = Array.from(manager.clusters.values())
      .map((s) => s.ready)
      .every(Boolean);

    return c.json({
      status: allReady ? "healthy" : "unhealthy",
      config: {
        deployment: config.deployment.name,
        owner: {
          userID: config.deployment.ownerUserId,
        },
        tracingSamplePercentage: config.tracing.samplePercentage,
      },
      clusters: manager.clusters.values().map((cluster) => ({
        id: cluster.id,
        ready: cluster.ready,
        restarts: {
          current: cluster.restarts.current,
          max: cluster.restarts.max,
          interval: cluster.restarts.interval,
        },
        process: {
          pid: (cluster.thread as Child)?.process?.pid,
          connected: (cluster.thread as Child)?.process?.connected,
        },
      })),
      totalShards: manager.totalShards,
    });
  });

  return Bun.serve({
    port: config.metrics.port,
    fetch: app.fetch,
  });
}

export default function server(
  manager: ClusterManager,
  commands: RESTPostAPIApplicationCommandsJSONBody[],
): Server[] {
  const healthServer = createHealthServer(manager);
  const monitoringServer = createMonitoringServer(manager, commands);

  logger.info(
    `health endpoint listening on http://localhost:${config.metrics.healthPort}/health`,
  );
  logger.info(
    `status endpoint listening on http://localhost:${config.metrics.port}/status`,
  );

  return [healthServer, monitoringServer];
}
