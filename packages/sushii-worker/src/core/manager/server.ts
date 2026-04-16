import type { Server } from "bun";
import type { Child, ClusterManager } from "discord-hybrid-sharding";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { routePath } from "hono/route";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { config } from "@/shared/infrastructure/config";
import log from "@/shared/infrastructure/logger";

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

const logger = log.child({ module: "http" });

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

function isManagerReady(manager: ClusterManager): boolean {
  if (manager.totalClusters <= 0 || manager.clusters.size < manager.totalClusters) {
    return false;
  }
  for (const c of manager.clusters.values()) {
    if (!c.ready) {
      return false;
    }
  }
  return true;
}

function serializeClusterSummary(cluster: {
  id: number;
  ready: boolean;
  shardList: number[];
}) {
  return { id: cluster.id, ready: cluster.ready, shards: cluster.shardList };
}

function serializeClusterDetail(cluster: {
  restarts: { current: number; max: number; interval: number };
  thread: unknown;
}) {
  return {
    restarts: {
      current: cluster.restarts.current,
      max: cluster.restarts.max,
      interval: cluster.restarts.interval,
    },
    process: {
      pid: (cluster.thread as Child)?.process?.pid,
      connected: (cluster.thread as Child)?.process?.connected,
    },
  };
}

function createHealthServer(manager: ClusterManager): Server<unknown> {
  const app = new Hono();

  // Middleware
  app.use("*", pinoLoggerMiddleware);

  // Routes
  app.get("/health", (c) => {
    // All clients are ready (1 client -> multiple shards)
    const allReady = isManagerReady(manager);

    const statusCode = allReady ? 200 : 503;

    return c.json(
      {
        status: allReady ? "healthy" : "unhealthy",
        clusters: Array.from(manager.clusters.values()).map((cluster) => ({
          ...serializeClusterSummary(cluster),
          ...serializeClusterDetail(cluster),
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

export function createMonitoringApp(
  manager: ClusterManager,
  commands: RESTPostAPIApplicationCommandsJSONBody[],
  deploymentService: DeploymentService,
): Hono<{ Bindings: MetricsBindings }> {
  const app = new Hono<{ Bindings: MetricsBindings }>();

  // Middleware
  app.use("*", pinoLoggerMiddleware);

  // Routes
  app.get("/commands", (c) => c.json(commands));
  app.get("/status", (c) => {
    const allReady = isManagerReady(manager);

    return c.json({
      status: allReady ? "healthy" : "unhealthy",
      config: {
        deployment: config.deployment.name,
        owner: {
          userID: config.deployment.ownerUserId,
        },
        tracingSamplePercentage: config.tracing.samplePercentage,
      },
      clusters: Array.from(manager.clusters.values()).map((cluster) => ({
        ...serializeClusterSummary(cluster),
        ...serializeClusterDetail(cluster),
      })),
      totalShards: manager.totalShards,
    });
  });

  app.get("/deployment/status", (c) => {
    const allReady = isManagerReady(manager);

    const thisDeployment = deploymentService.getProcessName();
    const activeDeployment = deploymentService.getCurrentDeployment();
    const isActive = deploymentService.isCurrentDeploymentActive();

    return c.json({
      this_deployment: thisDeployment,
      active_deployment: activeDeployment,
      is_active: isActive,
      ready_to_switch: allReady,
      health: allReady ? "healthy" : "unhealthy",
      clusters: Array.from(manager.clusters.values()).map(serializeClusterSummary),
      total_shards: manager.totalShards,
    });
  });

  app.post("/deployment/switch", async (c) => {
    // Parse and validate request body
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          error: "Invalid JSON in request body",
        },
        400,
      );
    }

    // Validate target is provided and valid
    if (
      !body ||
      typeof body !== "object" ||
      !("target" in body) ||
      (body.target !== "blue" && body.target !== "green")
    ) {
      return c.json(
        {
          error: "Invalid target. Must be 'blue' or 'green'",
        },
        400,
      );
    }

    const target = body.target as "blue" | "green";

    // Perform the switch
    try {
      const result = await deploymentService.setActiveDeployment(target);
      logger.info(
        { target, changed: result.changed },
        "Deployment switch handled",
      );

      if (!result.changed) {
        return c.json({ success: true, no_op: true });
      }

      return c.json({
        success: true,
        previous_deployment: result.previousDeployment,
        new_deployment: result.deployment,
      });
    } catch (err) {
      logger.error({ err, target }, "Failed to switch deployment");
      return c.json(
        {
          error: "Failed to switch deployment",
        },
        500,
      );
    }
  });

  return app;
}

function createMonitoringServer(
  manager: ClusterManager,
  commands: RESTPostAPIApplicationCommandsJSONBody[],
  deploymentService: DeploymentService,
): Server<unknown> {
  const app = createMonitoringApp(manager, commands, deploymentService);

  return Bun.serve({
    port: config.metrics.port,
    fetch: app.fetch,
  });
}

export default function server(
  manager: ClusterManager,
  commands: RESTPostAPIApplicationCommandsJSONBody[],
  deploymentService: DeploymentService,
): Server<unknown>[] {
  const healthServer = createHealthServer(manager);
  const monitoringServer = createMonitoringServer(
    manager,
    commands,
    deploymentService,
  );

  logger.info(
    `health endpoint listening on http://localhost:${config.metrics.healthPort}/health`,
  );
  logger.info(
    `status endpoint listening on http://localhost:${config.metrics.port}/status`,
  );
  logger.info(
    `deployment endpoints listening on http://localhost:${config.metrics.port}/deployment/*`,
  );

  return [healthServer, monitoringServer];
}
