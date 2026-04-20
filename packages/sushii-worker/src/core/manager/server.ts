import type { Server } from "bun";
import type { Child, ClusterManager } from "discord-hybrid-sharding";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { count, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { routePath } from "hono/route";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import {
  botStatsInAppPublic,
  modLogsInAppPublic,
} from "@/infrastructure/database/schema";
import { StatName } from "@/features/stats/domain/StatName";
import { config } from "@/shared/infrastructure/config";
import log from "@/shared/infrastructure/logger";

import type { HealthCheckService, ShardInfo } from "./HealthCheckService";

const logger = log.child({ module: "http" });

const SHARD_STATUS_READY = 0;

const pinoLoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const elapsedMs = Date.now() - start;

  const logEntry = {
    method: c.req.method,
    path: routePath(c),
    status: c.res.status,
    elapsedMs,
  };

  const message = `${c.req.method} ${c.req.path} ${c.res.status} ${elapsedMs} ms`;
  logger.debug(logEntry, message);
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

interface HealthSnapshot {
  shardData: ShardInfo[] | null;
  healthy: boolean;
  checks: {
    clusters: "pass" | "fail";
    database: "pass" | "fail";
    shards: "pass" | "fail";
  };
}

async function buildHealthSnapshot(
  manager: ClusterManager,
  healthCheckService: HealthCheckService,
): Promise<HealthSnapshot> {
  const clustersReady = isManagerReady(manager);
  const [dbCheck, shardData] = await Promise.all([
    healthCheckService.checkDatabase(),
    healthCheckService.getShardData(),
  ]);
  const shardsCheck =
    shardData !== null && shardData.every((s) => s.status === SHARD_STATUS_READY)
      ? "pass"
      : "fail";
  const healthy = clustersReady && dbCheck === "pass" && shardsCheck === "pass";

  const checks = {
    clusters: clustersReady ? "pass" : "fail",
    database: dbCheck,
    shards: shardsCheck,
  } as const;

  return { shardData, healthy, checks };
}

export function createHealthApp(
  manager: ClusterManager,
  healthCheckService: HealthCheckService,
): Hono {
  const app = new Hono();

  app.use("*", pinoLoggerMiddleware);

  app.get("/health", async (c) => {
    const { checks, healthy } = await buildHealthSnapshot(manager, healthCheckService);
    const statusCode = healthy ? 200 : 503;

    return c.json(
      {
        status: healthy ? "healthy" : "unhealthy",
        uptime_seconds: Math.floor(healthCheckService.getUptimeSeconds()),
        checks,
        memory: healthCheckService.getMemory(),
      },
      statusCode,
    );
  });

  return app;
}

function createHealthServer(
  manager: ClusterManager,
  healthCheckService: HealthCheckService,
): Server<unknown> {
  const app = createHealthApp(manager, healthCheckService);

  return Bun.serve({
    port: config.metrics.healthPort,
    fetch: app.fetch,
  });
}

export function createMonitoringApp(
  manager: ClusterManager,
  commands: RESTPostAPIApplicationCommandsJSONBody[],
  deploymentService: DeploymentService,
  healthCheckService: HealthCheckService,
): Hono {
  const app = new Hono();

  app.use("*", pinoLoggerMiddleware);

  app.get("/commands", (c) => c.json(commands));

  app.get("/status", async (c) => {
    const { checks, shardData, healthy } = await buildHealthSnapshot(manager, healthCheckService);

    return c.json({
      status: healthy ? "healthy" : "unhealthy",
      config: {
        deployment: config.deployment.name,
        owner: {
          user_id: config.deployment.ownerUserId,
        },
        tracing_sample_percentage: config.tracing.samplePercentage,
      },
      uptime_seconds: Math.floor(healthCheckService.getUptimeSeconds()),
      checks,
      clusters: Array.from(manager.clusters.values()).map((cluster) => ({
        ...serializeClusterSummary(cluster),
        ...serializeClusterDetail(cluster),
      })),
      shards: shardData ?? [],
      total_shards: manager.totalShards,
      memory: healthCheckService.getMemory(),
    });
  });

  app.get("/deployment/status", async (c) => {
    const { checks, shardData, healthy } = await buildHealthSnapshot(manager, healthCheckService);

    const uptimeSeconds = healthCheckService.getUptimeSeconds();
    const uptimeCheck = healthCheckService.isUptimeReady() ? "pass" : "fail";

    const readyToSwitch =
      healthy && uptimeCheck === "pass";

    const thisDeployment = deploymentService.getProcessName();
    const activeDeployment = deploymentService.getCurrentDeployment();
    const isActive = deploymentService.isCurrentDeploymentActive();

    return c.json({
      this_deployment: thisDeployment,
      active_deployment: activeDeployment,
      is_active: isActive,
      ready_to_switch: readyToSwitch,
      health: healthy ? "healthy" : "unhealthy",
      uptime_seconds: Math.floor(uptimeSeconds),
      checks: {
        ...checks,
        uptime: uptimeCheck,
      },
      clusters: Array.from(manager.clusters.values()).map(serializeClusterSummary),
      shards: shardData ?? [],
      total_shards: manager.totalShards,
      memory: healthCheckService.getMemory(),
    });
  });

  app.post("/deployment/switch", async (c) => {
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
  healthCheckService: HealthCheckService,
): Server<unknown> {
  const app = createMonitoringApp(manager, commands, deploymentService, healthCheckService);

  return Bun.serve({
    port: config.metrics.port,
    fetch: app.fetch,
  });
}

const STATS_CACHE_TTL_MS = 60_000;

interface StatsCache {
  data: {
    guild_count: number;
    member_count: number;
    mod_action_count: number;
  };
  cachedAt: number;
}

export function createPublicApp(
  db: NodePgDatabase<typeof schema>,
): Hono {
  const app = new Hono();
  let cache: StatsCache | null = null;

  app.use("*", pinoLoggerMiddleware);

  app.use("/v1/stats", cors({ origin: "*" }));

  app.get("/v1/stats", async (c) => {
    const now = Date.now();

    if (cache && now - cache.cachedAt < STATS_CACHE_TTL_MS) {
      c.header("Cache-Control", "public, max-age=60");
      return c.json(cache.data);
    }

    const [botStats, modActionCount] = await Promise.all([
      db
        .select({ name: botStatsInAppPublic.name, count: botStatsInAppPublic.count })
        .from(botStatsInAppPublic)
        .where(
          sql`${botStatsInAppPublic.name} IN (${StatName.GuildCount}, ${StatName.MemberCount})`,
        ),
      db
        .select({ count: count() })
        .from(modLogsInAppPublic)
        .then((rows) => rows[0]?.count ?? 0),
    ]);

    const statsMap = Object.fromEntries(
      botStats.map((s) => [s.name, Number(s.count)]),
    );

    cache = {
      data: {
        guild_count: statsMap[StatName.GuildCount] ?? 0,
        member_count: statsMap[StatName.MemberCount] ?? 0,
        mod_action_count: Number(modActionCount),
      },
      cachedAt: now,
    };

    c.header("Cache-Control", "public, max-age=60");
    return c.json(cache.data);
  });

  return app;
}

function createPublicServer(
  db: NodePgDatabase<typeof schema>,
): Server<unknown> {
  const app = createPublicApp(db);

  return Bun.serve({
    port: config.metrics.publicApiPort,
    fetch: app.fetch,
  });
}

export default function server(
  manager: ClusterManager,
  commands: RESTPostAPIApplicationCommandsJSONBody[],
  deploymentService: DeploymentService,
  healthCheckService: HealthCheckService,
  db: NodePgDatabase<typeof schema>,
): Server<unknown>[] {
  const healthServer = createHealthServer(manager, healthCheckService);
  const monitoringServer = createMonitoringServer(
    manager,
    commands,
    deploymentService,
    healthCheckService,
  );
  const publicServer = createPublicServer(db);

  logger.info(
    `health endpoint listening on http://localhost:${config.metrics.healthPort}/health`,
  );
  logger.info(
    `status endpoint listening on http://localhost:${config.metrics.port}/status`,
  );
  logger.info(
    `deployment endpoints listening on http://localhost:${config.metrics.port}/deployment/*`,
  );
  logger.info(
    `public API listening on http://localhost:${config.metrics.publicApiPort}/v1/stats`,
  );

  return [healthServer, monitoringServer, publicServer];
}
