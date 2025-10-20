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

function createHealthServer(manager: ClusterManager): Server<unknown> {
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
  deploymentService: DeploymentService,
): Server<unknown> {
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

  app.get("/deployment/status", (c) => {
    const allReady = Array.from(manager.clusters.values())
      .map((s) => s.ready)
      .every(Boolean);

    const thisDeployment = deploymentService.getProcessName();
    const activeDeployment = deploymentService.getCurrentDeployment();
    const isActive = deploymentService.isCurrentDeploymentActive();

    return c.json({
      this_deployment: thisDeployment,
      active_deployment: activeDeployment,
      is_active: isActive,
      ready_to_switch: allReady,
      health: allReady ? "healthy" : "unhealthy",
      clusters: manager.clusters.values().map((cluster) => ({
        id: cluster.id,
        ready: cluster.ready,
        shards: cluster.shardList,
      })),
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

    const thisDeployment = deploymentService.getProcessName();

    // Validate target matches this instance
    if (target !== thisDeployment) {
      logger.warn(
        { target, thisDeployment },
        "Deployment switch rejected: target does not match this instance",
      );

      return c.json(
        {
          error: `Target deployment '${target}' does not match this instance '${thisDeployment}'`,
        },
        400,
      );
    }

    // Check if all clusters are ready
    const allReady = Array.from(manager.clusters.values())
      .map((s) => s.ready)
      .every(Boolean);

    if (!allReady) {
      logger.warn(
        { target, thisDeployment },
        "Deployment switch rejected: not all clusters are ready",
      );
      return c.json(
        {
          error: "This deployment is not ready. Not all clusters are ready.",
          clusters: manager.clusters.values().map((cluster) => ({
            id: cluster.id,
            ready: cluster.ready,
            shards: cluster.shardList,
          })),
        },
        503,
      );
    }

    // Check if already active
    const isActive = deploymentService.isCurrentDeploymentActive();
    if (isActive) {
      logger.info(
        { target, thisDeployment },
        "Deployment switch rejected: already active deployment",
      );
      return c.json(
        {
          error: `Deployment '${target}' is already the active deployment`,
        },
        409,
      );
    }

    // Perform the switch
    try {
      const result = await deploymentService.setActiveDeployment(target);
      logger.info(
        { target, thisDeployment, changed: result.changed },
        "Deployment switched successfully",
      );

      // This should never be false due to the isActive check above, but handle it anyway
      const previousDeployment = result.changed
        ? target === "blue"
          ? "green"
          : "blue"
        : result.deployment; // If somehow no change occurred, previous = current

      return c.json({
        success: true,
        previous_deployment: previousDeployment,
        new_deployment: result.deployment,
      });
    } catch (err) {
      logger.error({ err, target, thisDeployment }, "Failed to switch deployment");
      return c.json(
        {
          error: "Failed to switch deployment",
        },
        500,
      );
    }
  });

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
